export const getSettings = () => {
  const settings = {
    network: {
      name: process.env.NETWORK_NAME,
      prefix: process.env.NETWORK_PREFIX,
      decimals: process.env.NETWORK_DECIMALS,
      token: process.env.NETWORK_TOKEN,
    },
    trophyCount: parseInt(process.env.TROPHY_COUNT),
    startReferendum: parseInt(process.env.START_REFERENDUM),
    shelfCollectionSymbol: process.env.SHELF_COLLECTION_SYMBOL.toString(),
    trophyCollectionSymbol: process.env.TROPHY_COLLECTION_SYMBOL.toString(),
    shelfNFTSymbol: process.env.SHELF_NFT_SYMBOL.toString()
  };
  return settings;
};
