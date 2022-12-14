import pLimit from 'p-limit';
import { Readable } from 'stream';
import fs from 'fs';
import { PinataPinOptions } from '@pinata/sdk';
import { sleep } from './utils.js';
import { params } from '../config.js';
import { Metadata } from 'rmrk-tools/dist/tools/types';
import { logger } from "./logger.js";

const defaultOptions: Partial<PinataPinOptions> = {
    pinataOptions: {
        cidVersion: 1,
    },
};

const fsPromises = fs.promises;
export type StreamPinata = Readable & {
    path?: string;
};

const limit = pLimit(1);

const pinFileStreamToIpfs = async (file: StreamPinata, name?: string): Promise<string> => {
    const options = { ...defaultOptions, pinataMetadata: { name } };
    const result = await params.pinata.pinFileToIPFS(file, options);
    return result.IpfsHash;
};

export const uploadAndPinIpfsMetadata = async (metadataFields: Metadata): Promise<string> => {
    const options = {
        ...defaultOptions,
        pinataMetadata: { name: metadataFields.name },
    };
    try {
        const metadata = { ...metadataFields };
        const metadataHashResult = await params.pinata.pinJSONToIPFS(metadata, options);
        return `ipfs://ipfs/${metadataHashResult.IpfsHash}`;
    } catch (error) {
        logger.info("trying again");
        await sleep(2000);
        //try again
        return await uploadAndPinIpfsMetadata(metadataFields);
    }
};

export const pinSingleMetadataFromDir = async (
    dir: string,
    path: string,
    name: string,
    metadataBase: Partial<Metadata>,
): Promise<string> => {
    try {
        const imageFile = await fsPromises.readFile(`${process.cwd()}${dir}/${path}`);
        if (!imageFile) {
            throw new Error('No image file');
        }

        const stream: StreamPinata = Readable.from(imageFile);
        stream.path = path;

        const imageCid = await pinFileStreamToIpfs(stream, name);
        logger.info(`NFT ${path} IMAGE CID: `, imageCid);
        const metadata: Metadata = { ...metadataBase, name, mediaUri: `ipfs://ipfs/${imageCid}` };
        const metadataCid = await uploadAndPinIpfsMetadata(metadata);
        await sleep(500);
        logger.info(`NFT ${name} METADATA: `, metadataCid);
        return metadataCid;
    } catch (error) {
        logger.info(error);
        logger.info(JSON.stringify(error));
        return '';
    }
};

export const pinSingleFileFromDir = async (
    dir: string,
    path: string,
    name: string
): Promise<string> => {
    try {
        const imageFile = await fsPromises.readFile(`${process.cwd()}${dir}/${path}`);
        if (!imageFile) {
            throw new Error('No image file');
        }

        const stream: StreamPinata = Readable.from(imageFile);
        stream.path = path;

        const imageCid = await pinFileStreamToIpfs(stream, name);
        logger.info(`NFT ${path} IMAGE CID: `, imageCid);
        return imageCid;
    } catch (error) {
        
        logger.info(error);

        logger.info(JSON.stringify(error));
        logger.info("trying again");
        await sleep(2000);
        //try again
        return await pinSingleFileFromDir(dir, path, name);
    }
};

export const pinSingleWithThumbMetadataFromDir = async (
    dir: string,
    pathMedia: string,
    name: string,
    metadataBase: Partial<Metadata>,
    pathThumb?: string,
): Promise<string[]> => {
    try {
        const mainMedia = await fsPromises.readFile(`${process.cwd()}${dir}/${pathMedia}`);
        if (!mainMedia) {
            throw new Error('No main media file');
        }

        const stream: StreamPinata = Readable.from(mainMedia);
        stream.path = pathMedia;

        const mainCid = await pinFileStreamToIpfs(stream, name);
        logger.info(`NFT ${pathMedia} Media CID: `, mainCid);
        let thumbCid;
        if (pathThumb) {
            const thumbMedia = await fsPromises.readFile(`${process.cwd()}${dir}/${pathThumb}`);
            if (!thumbMedia) {
                throw new Error('No thumb media file');
            }

            const stream: StreamPinata = Readable.from(thumbMedia);
            stream.path = pathThumb;

            thumbCid = await pinFileStreamToIpfs(stream, name);
            logger.info(`NFT ${pathThumb} Thumb CID: `, thumbCid);
        }
        const metadata: Metadata = { ...metadataBase, name, mediaUri: `ipfs://ipfs/${mainCid}`, thumbnailUri: `ipfs://ipfs/${thumbCid || mainCid}` };
        const metadataCid = await uploadAndPinIpfsMetadata(metadata);
        await sleep(500);
        logger.info(`NFT ${name} METADATA: `, metadataCid);
        return [metadataCid, mainCid, thumbCid || mainCid];
    } catch (error) {
        logger.info(error);
        logger.info(JSON.stringify(error));
        return [];
    }
};

export const pinSingleMetadata = async (
    buffer: Buffer,
    name: string,
    metadataBase: Partial<Metadata>,
): Promise<string> => {
    try {
        if (!buffer) {
            throw new Error('No image file');
        }
        const stream: StreamPinata = Readable.from(buffer);
        stream.path = "nft_file.png";
        const imageCid = await pinFileStreamToIpfs(stream, name);
        logger.info(`NFT ${name} IMAGE CID: `, imageCid);
        const metadata: Metadata = { ...metadataBase, name, mediaUri: `ipfs://ipfs/${imageCid}` };
        const metadataCid = await uploadAndPinIpfsMetadata(metadata);
        await sleep(500);
        logger.info(`NFT ${name} METADATA: `, metadataCid);
        return metadataCid;
    } catch (error) {
        logger.info(error);
        logger.info(JSON.stringify(error));
        return '';
    }
};

export const pinSingleMetadataWithoutFile = async (
    name: string,
    metadataBase: Partial<Metadata>,
): Promise<string> => {
    try {
        const metadata: Metadata = { ...metadataBase, name };
        const metadataCid = await uploadAndPinIpfsMetadata(metadata);
        await sleep(500);
        logger.info(`NFT ${name} METADATA: `, metadataCid);
        return metadataCid;
    } catch (error) {
        logger.info(error);
        logger.info(JSON.stringify(error));
        logger.info("trying again");
        await sleep(2000);
        //try again
        return await pinSingleMetadataWithoutFile(name, metadataBase);
    }
};

export const pinSingleFile = async (
    buffer: Buffer,
    name: string,
): Promise<string> => {
    try {
        if (!buffer) {
            throw new Error('No image file');
        }
        const stream: StreamPinata = Readable.from(buffer);
        stream.path = "file.png";
        const imageCid = await pinFileStreamToIpfs(stream, name);
        logger.info(`NFT ${name} IMAGE CID: `, imageCid);
        return imageCid;
    } catch (error) {
        logger.info(error);
        logger.info(JSON.stringify(error));
        return '';
    }
};


export const unpin = async (cid: string): Promise<string> => {
    try {
        const status = await params.pinata.unpin(cid.replace("ipfs://ipfs/", ""));
        return status;
    } catch (error) {
        logger.info(error);
        logger.info(JSON.stringify(error));
        return '';
    }
};


