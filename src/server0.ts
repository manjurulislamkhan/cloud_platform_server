// src/app.ts
if (process.env.NODE_ENV !== 'production') { // Only load dotenv for local development
  require('dotenv').config();
}

import './config/firebase_config'; // This will initialize Firebase

import express from 'express';
import http from 'http'; // For server type
import * as admin from 'firebase-admin'; // If you need to use admin features directly in this file
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { connectToDb } from './db'; // Assuming this returns a Promise
import { router } from './routes';

const app = express();
const EFFECTIVE_PORT = process.env.PORT || 8080; // Consistent port

app.use(cors()); // Consider configuring CORS options more restrictively for production
app.use(helmet());
app.use(compression());
app.use(express.json());

let server: http.Server;

connectToDb()
  .then(() => {
   
    app.use('/api', router);

    // Health check endpoint (good for Cloud Run)
    app.get('/_health', (req, res) => {
      res.status(200).send('ok');
    });

    server = app.listen(EFFECTIVE_PORT, () => {
      console.log(`Server listening on port ${EFFECTIVE_PORT}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize the application:', error);
    process.exit(1); // Exit if essential services like DB fail
  });

const gracefulShutdown = (signal: string) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('HTTP server closed.');
      // Add any other cleanup logic here (e.g., admin.app().delete() if needed, database.close())
      // Example: if (typeof admin.app === 'function' && admin.app()) { admin.app().delete(); }
      // Example: if (dbClient) { dbClient.close(); }
      console.log('Cleanup finished. Exiting.');
      process.exit(0);
    });
  } else {
    console.log('Server not started or already closed. Exiting.');
    process.exit(0); // If server wasn't even up, just exit
  }


  // If server hasn't finished in a reasonable time, force shutdown
  // Cloud Run default is 10s, so set this slightly lower.
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 9500); // e.g., 9.5 seconds
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // From Cloud Run
process.on('SIGINT', () => gracefulShutdown('SIGINT'));  // For local Ctrl+C

// Optional: Handle unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
  // Consider a graceful shutdown here as well, as the app might be in an unstable state
  // gracefulShutdown('UNHANDLED_REJECTION'); // This might be too aggressive depending on the error
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Application specific logging
  // It's generally recommended to exit gracefully after an uncaught exception,
  // as the application state is unknown.
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});