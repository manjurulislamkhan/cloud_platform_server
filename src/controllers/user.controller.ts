// src/controllers/user.controller.ts
import { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import { RequestWithUser } from '../middleware/auth.middleware';

const db = admin.firestore();
const usersCollection = db.collection('users');

export const getCurrentUser = async (req: Request, res: Response) => {
  const userReq = req as RequestWithUser;
  if (!userReq.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    const userDoc = await usersCollection.doc(userReq.user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(userDoc.data());
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user', error });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const { name, email, role } = req.body;
    const userRecord = await admin.auth().createUser({ email, password: req.body.password });
    await usersCollection.doc(userRecord.uid).set({ name, email, role });
    res.status(201).json({ message: 'User created successfully', userId: userRecord.uid });
  } catch (error) {
    res.status(500).json({ message: 'Error creating user', error });
  }
};

export const getUser = async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const userDoc = await usersCollection.doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(userDoc.data());
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user', error });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const { name, email, role } = req.body;
    await usersCollection.doc(userId).update({ name, email, role });
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating user', error });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    await admin.auth().deleteUser(userId);
    await usersCollection.doc(userId).delete();
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user', error });
  }
};