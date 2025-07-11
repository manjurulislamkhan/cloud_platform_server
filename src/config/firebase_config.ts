// src/config/firebase_config.ts
import * as admin from 'firebase-admin';

function initializeFirebaseAdmin() {
  // Check if an app is already initialized to prevent errors
  if (admin.apps.length > 0) {
    console.log('Firebase Admin SDK already initialized.');
    return admin.app(); // Return the default app instance
  }

  try {
    const storageBucketEnv = process.env.FIREBASE_STORAGE_BUCKET;
    if (!storageBucketEnv) {
      console.warn(
        'FIREBASE_STORAGE_BUCKET environment variable is not set. ' +
        'Firebase Storage operations might be affected.'
      );
    }

    const appOptions: admin.AppOptions = {
      storageBucket: storageBucketEnv,
    };

    // K_SERVICE is set by Cloud Run, K_REVISION and K_CONFIGURATION are also good indicators.
    // GOOGLE_CLOUD_PROJECT is also usually available in GCP environments.
    if (process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT) {
      // Running in a GCP environment (like Cloud Run)
      // Use Application Default Credentials.
      // Ensure the Cloud Run service account has necessary Firebase IAM roles.
      console.log('Initializing Firebase Admin SDK with Application Default Credentials (GCP environment).');
      appOptions.credential = admin.credential.applicationDefault();
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Local development or other environments where GOOGLE_APPLICATION_CREDENTIALS is set
      console.log('Initializing Firebase Admin SDK using GOOGLE_APPLICATION_CREDENTIALS environment variable.');
      appOptions.credential = admin.credential.applicationDefault(); // ADC will use the env var
    } else {
      // Fallback to a local service account file (less recommended, ensure it's gitignored)
      // This path is relative to the *project root* typically when GOOGLE_APPLICATION_CREDENTIALS is used,
      // but if you must require it, ensure the path is correct from the compiled JS file.
      // For demonstration, if you still want to use a direct require for a specific local fallback:
      console.warn(
        'Initializing Firebase Admin SDK with a local service account file. ' +
        'Ensure GOOGLE_APPLICATION_CREDENTIALS is set for better practice.'
      );
      try {
        // Path is relative to the JS output file (e.g., dist/config/firebase_config.js)
        const serviceAccount = require('../../../service_account.json'); // Adjust path carefully
        appOptions.credential = admin.credential.cert(serviceAccount);
      } catch (error) {
        console.error(
            'Failed to load local service account file (../../service_account.json). ' +
            'Ensure the file exists and the path is correct, or set GOOGLE_APPLICATION_CREDENTIALS.',
            error
        );
        throw new Error('Firebase Admin SDK initialization failed due to missing local credentials.');
      }
    }

    admin.initializeApp(appOptions);
    console.log('Firebase Admin SDK initialized successfully.');

  } catch (error) {
    console.error('Firebase Admin SDK initialization failed:', error);
    // Depending on your application, you might want to throw the error
    // or handle it in a way that allows the app to run in a degraded mode.
    // For many apps, Firebase is critical, so exiting might be appropriate.
    process.exit(1); // Or throw error to be caught by a global error handler
  }
}

// Initialize Firebase when this module is loaded.
initializeFirebaseAdmin();

// Export the initialized admin instance for use in other parts of the application.
export default admin;