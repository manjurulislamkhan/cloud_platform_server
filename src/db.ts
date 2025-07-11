

import { Db, MongoClient } from "mongodb";



const client: MongoClient = new MongoClient(process.env.MONGODB_URL as string);

let db: Db;

export async function connectToDb() {




  function WaitForConnection(): Promise<boolean> {
    return new Promise((resolve, reject) => {


      try {
        // Connect the client to the server
        client.connect().then(() => {
          db = client.db(process.env.MONGO_DB_NAME);
          console.log("Summa Alhamdulillah.. Mongodb connected..Connected successfully to server");

          resolve(true)

        })
      }

      catch (error) {
        client.close();
        console.error('Failed to connect to the database. Shutting down.', error);
        process.exit(1); // Exit with a non-zero code to indicate failure
      }

    })
  }


  return await WaitForConnection()
}

export function getDb() {
  return db
}

export function closeDb() {
  return client.close();
}

module.exports = { connectToDb, getDb, closeDb }