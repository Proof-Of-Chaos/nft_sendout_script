export const getSettings = () => {
  const settings = {
    network: {
      name: process.env.NETWORK_NAME,
      prefix: process.env.NETWORK_PREFIX,
      decimals: process.env.NETWORK_DECIMALS,
      token: process.env.NETWORK_TOKEN,
    },
    collectionSymbol: process.env.COLLECTION_SYMBOL.toString(),
    collectionName: process.env.COLLECTION_NAME.toString(),
    parentHeight: 13,
    parentWidth: 13,
    parentNFTSymbol: process.env.PARENT_NFT_SYMBOL.toString(),
  };
  return settings;
};
