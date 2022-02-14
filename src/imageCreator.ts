import { params } from "../config.js";
import Jimp from "jimp";
import fs from 'fs';
import { logger } from "../tools/logger.js";
import type { BN } from '@polkadot/util';
import { getSettingsFile } from "../tools/utils.js";
import { Settings } from "http2";

const fsPromises = fs.promises;

const rect = (img, x1, y1, x2, y2, height, fill) => {
    var black = Jimp.rgbaToInt(0, 0, 0, 255);
    var white = Jimp.rgbaToInt(255, 255, 255, 255);
    if (fill) {
        if (x1 < x2) {
            for (var x = x1; x <= x2; x++) {
                for (var y = y1; y <= height; y++) {
                    img.setPixelColor(black, x, y);
                }
            }
        }
    }
    if (!fill) {
        if (x1 < x2) {
            for (var x = x1; x <= x2; x++) {
                for (var y = y1; y <= height; y++) {
                    if (y == y1 || y == height || x == x1 || x == x2) {
                        img.setPixelColor(black, x, y);
                    }
                    else {
                        img.setPixelColor(white, x, y);
                    }
                }
            }
        }
        if (x1 == x2)
            throw "Can't draw a rectangle on one point";
        if (x1 > x2) {
            for (var x = x2; x <= x1; x++) {
                for (var y = y1; y <= height; y++) {
                    if (y == y1 || y == height || x == x1 || x == x2) {
                        img.setPixelColor(black, x, y);
                    }
                    else {
                        img.setPixelColor(white, x, y);
                    }
                }
            }
        }
    }
}

export const createParentCanvas = async () => {
    //check if parent file already exists
    try {
        await fsPromises.readFile(`${process.cwd()}/assets/mosaic/parent.png`);
        logger.info("parent canvas already exists")
    }
    catch (e) {
        //create canvas file if doesn't exist yet
        logger.info("creating canvas file")
        const image = new Jimp(params.settings.parentHeight, params.settings.parentWidth);
        let file = "assets/mosaic/parent.png";
        await image.writeAsync(file);
        logger.info("parent canvas created")
    }
}

//create children NFTs
export const createMosaicTiles = async (referendumId: BN): Promise<string[]> => {
    //check if specific settings file
    let settingsFile = await getSettingsFile(referendumId);
    //logger.info(`reading settings from ${settingsPath}`)
    //let settingsFile = await fetch(settingsPath);
    let settings = await JSON.parse(settingsFile);
    logger.info(`settings:\n${settings.colors}`)
    let tileId = await params.tileCountAdapter.get()
    try {
        await fsPromises.readdir(`${process.cwd()}/assets/mosaic/${tileId}-${referendumId}`)
        logger.info(`directory /assets/mosaic/${tileId}-${referendumId} already exists. 
            Delete this directory first if you would like to create new tiles`)
        return ["-1", "-1"];
    }
    catch (e) {
        logger.info(`creating directory /assets/mosaic/${tileId}-${referendumId}`)
        fsPromises.mkdir(`${process.cwd()}/assets/mosaic/${tileId}-${referendumId}`)//, { recursive: true })
        for (const color of settings.colors) {
            const colorInt = Jimp.rgbaToInt(color[0], color[1], color[2], color[3]);
            logger.info(`creating tile for color ${color} -> ${colorInt}`)
            //creating see through png
            const image = new Jimp(params.settings.parentHeight, params.settings.parentWidth);
            //adding a color to pixel tileId
            console.log("x", tileId % params.settings.parentWidth)
            console.log("y", Math.floor(tileId / params.settings.parentWidth))
            image.setPixelColor(colorInt, tileId % params.settings.parentWidth, Math.floor(tileId / params.settings.parentWidth))
            let file = `assets/mosaic/${tileId}-${referendumId}/${colorInt}.png`;
            await image.writeAsync(file);
            logger.info(`file created assets/mosaic/${tileId}-${referendumId}/${colorInt}.png`)
        }
        await params.tileCountAdapter.set(++tileId)
        return [tileId.toString(), referendumId.toString()];
    }


}

export const mergeImages = async () => {
    logger.info("merging images")
    let image = await Jimp.read(`${process.cwd()}/assets/mosaic/parent.png`)
    const src = await Jimp.read(`${process.cwd()}/assets/mosaic/0-171/1690829055.png`)
    const src1 = await Jimp.read(`${process.cwd()}/assets/mosaic/1-172/170445055.png`)
    const src2 = await Jimp.read(`${process.cwd()}/assets/mosaic/2-172/1690829055.png`)
    const src3 = await Jimp.read(`${process.cwd()}/assets/mosaic/3-172/170445055.png`)
    const src4 = await Jimp.read(`${process.cwd()}/assets/mosaic/4-172/1690829055.png`)
    const src5 = await Jimp.read(`${process.cwd()}/assets/mosaic/5-172/170445055.png`)
    image = image.composite(src, 0, 0);
    image = image.composite(src1, 0, 0);
    image = image.composite(src2, 0, 0);
    image = image.composite(src3, 0, 0);
    image = image.composite(src4, 0, 0);
    image = image.composite(src5, 0, 0);
    await image.writeAsync(`assets/mosaic/merged.png`);
}
