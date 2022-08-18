import { upsertReferenda } from "./mongo/service/referendum.js";
import { logger } from '../tools/logger.js';
import dotenv from "dotenv";
import fetch from 'node-fetch';
import { sleep } from '../tools/utils.js';

dotenv.config();

export const getReferendumData = async (referendumIndex, retry = 0): Promise<any> => {
    try {
        const response = await fetch("https://kusama.api.subscan.io/api/scan/democracy/referendum", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.SUBSCAN_API
            },
            body: JSON.stringify({ "referendum_index": referendumIndex })
        });
        return response
    } catch (e) {
        if (retry < 10) {
            logger.info(`getReferendumData request failed. Retrying`);
            await sleep(2 * 1000);
            return await getReferendumData(referendumIndex, retry + 1);
        }
        else {
            logger.error(`Error in getReferendumData`, e);
            return;
        }
    }
}

export const getReferendumVotes = async (page, referendumIndex, retry = 0) => {
    try {
        const response = await fetch("https://kusama.api.subscan.io/api/scan/democracy/votes", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.SUBSCAN_API
            },
            body: JSON.stringify({ "referendum_index": referendumIndex, "row": 100, "page": page })
        });
        let responseJSON: any = await response.json()
        if (response && responseJSON.message != "Success") {
            if (retry < 10) {
                logger.info(`getReferendumVotes request failed. Retrying`);
                await sleep(2 * 1000);
                return await getReferendumVotes(page, referendumIndex, retry + 1);
            }
            else {
                logger.error(`Error in getReferendumVotes`);
                return;
            }
        }
        return responseJSON
    } catch (e) {
        if (retry < 10) {
            logger.info(`getReferendumVotes request failed. Retrying`);
            await sleep(2 * 1000);
            return await getReferendumVotes(page, referendumIndex, retry + 1);
        }
        else {
            logger.error(`Error in getReferendumVotes`, e);
            return;
        }
    }
}

const getReferendaData = async (page, retry = 0): Promise<any> => {
    try {
        const response = await fetch("https://kusama.api.subscan.io/api/scan/democracy/referendums", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.SUBSCAN_API
            },
            body: JSON.stringify({ "row": 100, "page": page })
        });
        return response
    } catch (e) {
        if (retry < 10) {
            logger.info(`getReferendaData request failed. Retrying`);
            await sleep(2 * 1000);
            return await getReferendaData(page, retry + 1);
        }
        else {
            logger.error(`Error in getReferendaData`, e);
            return;
        }
    }
}

export const upsertReferendaInDB = async () => {
    let count = 0;
    const response = await getReferendaData(count)
    let responseJSON = await response.json();
    while (responseJSON.message == "Success") {
        let referenda;
        if (responseJSON && responseJSON.message == "Success" && responseJSON.data.list) {
            referenda = responseJSON.data.list;
            await upsertReferenda(referenda)
        }
        const response = await getReferendaData(++count)
        responseJSON = await response.json();
    }
}