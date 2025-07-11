


import express, { Request, response, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { MongoClient, Db, ObjectId, Collection } from 'mongodb';
import http from 'http';
import helmet from 'helmet';
import compression from 'compression';
import * as argon2 from 'argon2';

// --- SimpleWebAuthn for robust WebAuthn implementation ---
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
    VerifiedRegistrationResponse,
    VerifiedAuthenticationResponse,
    RegistrationResponseJSON,
    AuthenticationResponseJSON,
} from '@simplewebauthn/server';

// --- Environment Variable Configuration ---
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// --- Express App Initialization ---
const app = express();
const EFFECTIVE_PORT = process.env.PORT || 8080;
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'passkey_auth_enhanced';

// --- WebAuthn Relying Party (RP) Configuration ---
const RP_ID = process.env.RP_ID || 'localhost';
const RP_NAME = process.env.RP_NAME || 'Passkey Auth Enhanced Demo';
const ORIGIN = process.env.ORIGIN || `http://${RP_ID}:3000`;

// --- Middleware ---
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(helmet());
app.use(compression());
app.use(express.json());

// --- MongoDB Database Interfaces and Collections ---
interface User {
    _id: ObjectId;
    id: string; // User handle (unique ID for WebAuthn)
    email: string;
    name: string;
    passwordHash?: string;
    currentChallenge?: string;
    createdAt: Date;
}

// Represents the authenticator data stored in the DB
interface Authenticator {
    _id: ObjectId;
    userId: string;
    // The credentialID, stored as a base64url string for DB compatibility
    credentialID: string;
    credentialPublicKey: Buffer;
    counter: number;
    // `transports` can be an array of strings or undefined
    transports?: AuthenticatorTransport[];
}

let db: Db;
// Correctly type the collections
let usersCollection: Collection<User>;
let authenticatorsCollection: Collection<Authenticator>;
let mongoClient: MongoClient;

// --- Initialize MongoDB connection ---
const connectDB = async () => {
    try {
        mongoClient = new MongoClient(MONGODB_URL);
        await mongoClient.connect();
        db = mongoClient.db(DB_NAME);

        // Assign typed collections
        usersCollection = db.collection<User>('users');
        authenticatorsCollection = db.collection<Authenticator>('authenticators');

        await usersCollection.createIndex({ email: 1 }, { unique: true });
        await usersCollection.createIndex({ id: 1 }, { unique: true });
        await authenticatorsCollection.createIndex({ userId: 1 });
        await authenticatorsCollection.createIndex({ credentialID: 1 }, { unique: true });

        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

const generateUserId = (): string => crypto.randomBytes(32).toString('base64url');

// --- API Routes ---

// -- WebAuthn Registration --
app.post('/api/auth/register/begin', async (req: Request, res: Response) => {
    const { email, name } = req.body;

    if (!email || !name) {
        return res.status(400).json({ message: 'Email and name are required' });
    }

    let user = await usersCollection.findOne({ email });
    if (user) {
        return res.status(400).json({ message: 'User already exists' });
    }

    const newUserID = generateUserId();
    const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userID: Buffer.from(newUserID, 'utf-8'),
        userName: email, // Use email as the WebAuthn username
        attestationType: 'none',
        authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
            authenticatorAttachment: 'platform',
        },
    });

    // Create a temporary user record with the challenge
    await usersCollection.insertOne({
        _id: new ObjectId(),
        id: newUserID,
        email,
        name,
        currentChallenge: options.challenge,
        createdAt: new Date(),
    });

    res.json(options);
});


app.post('/api/auth/register/finish', async (req: Request, res: Response) => {
    // The request body contains the RegistrationResponseJSON
    const body: RegistrationResponseJSON = req.body;
    const { email } = req.query; // Pass email as a query param for identification

    if (typeof email !== 'string') {
        return res.status(400).json({ message: 'Email query parameter is required.' });
    }

    const user = await usersCollection.findOne({ email });

    if (!user || !user.currentChallenge) {
        return res.status(400).json({ message: 'User or challenge not found. Please try again.' });
    }

    let verification: VerifiedRegistrationResponse;
    try {
        verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge: user.currentChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            requireUserVerification: true,
        });
    } catch (error: any) {
        console.error(error);
        // Important: Clean up the temporary user record on failure
        await usersCollection.deleteOne({ _id: user._id });
        return res.status(400).json({ message: `Registration failed: ${error.message}` });
    }

    const { verified, registrationInfo } = verification;

    if (verified && registrationInfo) {
        const credentialPublicKey = registrationInfo.credential.publicKey;
        const credentialID = registrationInfo.credential.id;
        const counter = registrationInfo.credential.counter;

        await authenticatorsCollection.insertOne({
            _id: new ObjectId(),
            userId: user.id,
            // Store credentialID as a base64url string
            credentialID: Buffer.from(credentialID).toString('base64url'),
            credentialPublicKey: Buffer.from(credentialPublicKey),
            counter,
            transports: Array.isArray(body.response.transports)
                ? body.response.transports.filter(
                    (t): t is AuthenticatorTransport =>
                        t === 'usb' || t === 'ble' || t === 'nfc' || t === 'internal'
                  )
                : undefined,
        });
    }

    // Clean up the challenge from the user record
    await usersCollection.updateOne({ _id: user._id }, { $unset: { currentChallenge: "" } });

    res.json({ success: true, verified });
});


// -- WebAuthn Authentication (Login) --
app.post('/api/auth/login/begin', async (req: Request, res: Response) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    const user = await usersCollection.findOne({ email });
    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }

    const userAuthenticators = await authenticatorsCollection.find({ userId: user.id }).toArray();

    const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials: userAuthenticators.map(auth => ({
            id: auth.credentialID,
            type: 'public-key',
            transports: auth.transports,
        })),
        userVerification: 'required',
    });

    await usersCollection.updateOne({ _id: user._id }, { $set: { currentChallenge: options.challenge } });

    res.json(options);
});

app.post('/api/auth/login/finish', async (req: Request, res: Response) => {
    const body: AuthenticationResponseJSON = req.body;
    const { email } = req.query; // Pass email as a query param

    if (typeof email !== 'string') {
        return res.status(400).json({ message: 'Email query parameter is required.' });
    }

    const user = await usersCollection.findOne({ email });
    if (!user || !user.currentChallenge) {
        return res.status(400).json({ message: 'User or challenge not found. Please try again.' });
    }

    // Find the authenticator by its ID (which is base64url in the request)
    const authenticator = await authenticatorsCollection.findOne({
        credentialID: body.id,
    });

    if (!authenticator) {
        return res.status(404).json({ message: 'Authenticator not found.' });
    }

    let verification: VerifiedAuthenticationResponse;

    try {
        verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: user.currentChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: authenticator.credentialID,
                publicKey: authenticator.credentialPublicKey,
                counter: authenticator.counter,
            }
        });
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: `Login failed: ${error.message}` });
    }

    const { verified, authenticationInfo } = verification;

    if (verified) {
        await authenticatorsCollection.updateOne(
            { _id: authenticator._id },
            { $set: { counter: authenticationInfo.newCounter } }
        );
    }

    await usersCollection.updateOne({ _id: user._id }, { $unset: { currentChallenge: "" } });

    // NOTE: Implement session management (e.g., JWT) here for a real application
    res.json({ success: true, verified, user: { id: user.id, email: user.email, name: user.name } });
});

// --- Traditional Password-based Authentication Routes (Unchanged) ---
app.post('/api/auth/register/password', async (req, res) => {
    try {
        const { email, name, password } = req.body;
        if (!email || !name || !password) {
            return res.status(400).json({ message: 'Email, name, and password are required' });
        }
        if (await usersCollection.findOne({ email })) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }
        const passwordHash = await argon2.hash(password);
        const user: Omit<User, '_id'> = {
            id: generateUserId(),
            email,
            name,
            passwordHash,
            createdAt: new Date(),
        };
        const result = await usersCollection.insertOne(user as User);
        res.json({
            success: true,
            user: { id: user.id, email: user.email, name: user.name },
        });
    } catch (error) {
        console.error('Password registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/auth/login/password', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }
        const user = await usersCollection.findOne({ email });
        if (!user || !user.passwordHash) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        if (!(await argon2.verify(user.passwordHash, password))) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        res.json({
            success: true,
            user: { id: user.id, email: user.email, name: user.name },
        });
    } catch (error) {
        console.error('Password login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


// --- Server Management and Health Check (Unchanged) ---
app.get('/_health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

let server: http.Server;

const startServer = async () => {
    await connectDB();
    server = app.listen(EFFECTIVE_PORT, () => {
        console.log(`🚀 Server listening on port ${EFFECTIVE_PORT}`);
        console.log(`🌐 Relying Party ID: ${RP_ID}`);
        console.log(`🏠 Client Origin: ${ORIGIN}`);
    });
};

const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    if (server) {
        server.close(async () => {
            console.log('✅ HTTP server closed.');
            if (mongoClient) {
                await mongoClient.close();
                console.log('✅ MongoDB client closed.');
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
startServer().catch(console.error);