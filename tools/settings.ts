export const getSettings = () => {
  const settings = {
    network: {
      name: process.env.NETWORK_NAME,
      prefix: process.env.NETWORK_PREFIX,
      decimals: process.env.NETWORK_DECIMALS,
      token: process.env.NETWORK_TOKEN,
    },
    parentCollectionSymbol: process.env.PARENT_COLLECTION_SYMBOL.toString(),
    parentCollectionName: process.env.PARENT_COLLECTION_NAME.toString(),
    tileCollectionNamePrefix: process.env.TILE_COLLECTION_NAME_PEFIX.toString(),
    tileCollectionSymbolPrefix: process.env.TILE_COLLECTION_SYMBOL_PREFIX.toString(),
    parentHeight: 13,
    parentWidth: 13,
    parentNFTSymbol: process.env.PARENT_NFT_SYMBOL.toString(),
  };
  return settings;
};
