
// src/controllers/file.controller.ts
import { Request, Response } from 'express';
import * as admin from 'firebase-admin';

const bucket = admin.storage().bucket();

export const uploadFile = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const file = req.file;
    const fileName = `${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(fileName);

    const blobStream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    blobStream.on('error', (error) => {
      res.status(500).json({ message: 'Error uploading file', error });
    });

    blobStream.on('finish', async () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileUpload.name}`;
      res.status(200).json({ message: 'File uploaded successfully', url: publicUrl });
    });

    blobStream.end(file.buffer);
  } catch (error) {
    res.status(500).json({ message: 'Error uploading file', error });
  }
};