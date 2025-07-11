// src/controllers/notification.controller.ts
import { Request, Response } from 'express';
import * as admin from 'firebase-admin';

export const sendNotification = async (req: Request, res: Response) => {
  try {
    const { token, title, body } = req.body;
    const message = {
      notification: { title, body },
      token
    };
    const response = await admin.messaging().send(message);
    res.json({ message: 'Notification sent successfully', response });
  } catch (error) {
    res.status(500).json({ message: 'Error sending notification', error });
  }
};
