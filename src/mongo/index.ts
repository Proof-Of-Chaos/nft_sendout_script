import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { logger } from "../../tools/logger.js";

dotenv.config();

const getDbName = () => {
    const dbName = process.env.MONGO_DB_NAME;
    if (!dbName) {
        throw new Error("no MONGO_DB_NAME set");
    }

    return dbName;
}

const referendumCollectionName = "referendum";

let client = null;
let db = null;
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017";
let referendumCol = null;

export async function initDb() {
    client = await MongoClient.connect(mongoUri);

    const dbName = getDbName();
    logger.info('dbName:', dbName);
    db = client.db(dbName);
    referendumCol = db.collection(referendumCollectionName);
    await _createIndexes();
}

async function _createIndexes() {
    if (!db) {
        logger.error("Please call initDb first");
        process.exit(1);
    }
}

async function tryInit(col) {
    if (!col) {
        await initDb();
    }
}

export async function getReferendumCollection() {
    await tryInit(referendumCol);
    return referendumCol;
}