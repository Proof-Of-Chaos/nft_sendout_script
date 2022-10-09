export const getSettings = () => {
  const settings = {
    network: {
      name: process.env.NETWORK_NAME,
      prefix: process.env.NETWORK_PREFIX,
      decimals: process.env.NETWORK_DECIMALS,
      token: process.env.NETWORK_TOKEN,
    },
    itemCount: parseInt(process.env.ITEM_COUNT),
    startReferendum: parseInt(process.env.START_REFERENDUM),
    parentCollectionSymbol: process.env.SHELF_COLLECTION_SYMBOL.toString(),
    itemCollectionSymbol: process.env.ITEM_COLLECTION_SYMBOL.toString(),
    backgroundCollectionSymbol: process.env.BACKGROUND_COLLECTION_SYMBOL.toString(),
    decorationCollectionSymbol: process.env.DECORATION_COLLECTION_SYMBOL.toString(),
    foregroundCollectionSymbol: process.env.FOREGROUND_COLLECTION_SYMBOL.toString(),
    baseSymbol: process.env.BASE_SYMBOL.toString(),
    shelfNFTSymbol: process.env.SHELF_NFT_SYMBOL.toString(),
    externalUrl: process.env.EXTERNAL_URL.toString(),
    chunkSize: parseInt(process.env.CHUNK_SIZE),
    chunkSizeDefault: parseInt(process.env.CHUNK_SIZE_DEFAULT),
    chunkSizeShelf: parseInt(process.env.CHUNK_SIZE_SHELF),
    isTest: process.env.TEST === "true"
  };
  return settings;
};
