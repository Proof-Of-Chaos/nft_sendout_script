import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

function getDbName() {
    const dbName = process.env.MONGO_DB_NAME;
    if (!dbName) {
        throw new Error("no MONGO_DB_NAME set");
    }

    return dbName;
}

const voteCollectionName = "vote";
const referendumCollectionName = "referendum";
const proposalCollectionName = "proposal";
const bountyCollectionName = "bounty";
const userCollectionName = "user";
const alertCollectionName = "alert";

let client = null;
let db = null;
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017";
let voteCol = null;
let referendumCol = null;

export async function initDb() {
    client = await MongoClient.connect(mongoUri);

    const dbName = getDbName();
    console.log('dbName:', dbName);
    db = client.db(dbName);
    voteCol = db.collection(voteCollectionName);
    referendumCol = db.collection(referendumCollectionName);
    await _createIndexes();
}

async function _createIndexes() {
    if (!db) {
        console.error("Please call initDb first");
        process.exit(1);
    }
}

async function tryInit(col) {
    if (!col) {
        await initDb();
    }
}

export async function getVoteCollection() {
    await tryInit(voteCol);
    return voteCol;
}

export async function getReferendumCollection() {
    await tryInit(referendumCol);
    return referendumCol;
}