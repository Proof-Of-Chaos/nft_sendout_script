import { Collection, NFT, Base } from "rmrk-tools";
import { AcceptEntityType } from "rmrk-tools/dist/classes/accept";
import { IConsolidatorAdapter } from "rmrk-tools/dist/tools/consolidator/adapters/types";
import { BaseConsolidated, CollectionConsolidated, NFTConsolidated } from "rmrk-tools/dist/tools/consolidator/consolidator";
import _ from "lodash";
//@ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

export class RemarkStorageAdapter implements IConsolidatorAdapter {
  private db;
  constructor(db) {
    this.db = db;
  }

  public async getAllNFTs() {
    await this.db.read();
    return this.db.data.nfts;
  }

  public async getAllCollections() {
    await this.db.read();
    return this.db.data.collections;
  }

  public async getAllBases() {
    await this.db.read();
    return this.db.data.bases;
  }

  public async updateNFTEmote(nft: NFT, consolidatedNFT: NFTConsolidated): Promise<void> {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
      ...nftDb,
      reactions: nft?.reactions,
    }).value();
    await this.db.write();
  }

  public async updateBaseEquippable(
    base: Base,
    consolidatedBase: BaseConsolidated
  ): Promise<void> {
    await this.db.read();
    let baseDb: BaseConsolidated = this.db.data.bases.find(({ id }) => id === consolidatedBase.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("bases").find(({ id }) => id === consolidatedBase.id).assign({
      ...baseDb,
      parts: base?.parts,
    }).value();
    await this.db.write();
  }

  public async updateNFTList(nft: NFT, consolidatedNFT: NFTConsolidated): Promise<void> {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
      ...nftDb,
      forsale: nft?.forsale,
      changes: nft?.changes,
    }).value();
    await this.db.write();
  }

  public async updateEquip(nft: NFT, consolidatedNFT: NFTConsolidated) {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
      ...nftDb,
      children: nft.children,
    }).value();
    await this.db.write();
  }

  public async updateSetPriority(nft: NFT, consolidatedNFT: NFTConsolidated): Promise<void> {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
      ...nftDb,
      priority: nft.priority,
    }).value();
    await this.db.write();
  }

  public async updateSetAttribute(nft: NFT, consolidatedNFT: NFTConsolidated): Promise<void> {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
      ...nftDb,
      properties: nft.properties,
    }).value();
    await this.db.write();
  }

  public async updateNftAccept(
    nft: NFT,
    consolidatedNFT: NFTConsolidated,
    entity: AcceptEntityType
  ) {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    if (entity == "NFT") {
      this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
        ...nftDb,
        children: nft?.children,
        priority: nft?.priority || nftDb.priority,
      }).value();
    } else if (entity === "RES") {
      this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
        ...nftDb,
        resources: nft?.resources,
        priority: nft?.priority || nftDb.priority,
      }).value();
    }
    await this.db.write();
  }

  public async updateNftResadd(nft: NFT, consolidatedNFT: NFTConsolidated): Promise<void> {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
      ...nftDb,
      resources: nft?.resources,
      priority: nft?.priority || nftDb.priority,
    }).value();
    await this.db.write();
  }

  public async updateNFTChildrenRootOwner(
    nft: NFT | NFTConsolidated,
    rootowner?: string,
    level?: number
  ): Promise<void> {
    if ((level || 1) < 10 && nft.children && nft.children.length > 0) {
      const promises = nft.children.map(async (child) => {
        await this.db.read();
        let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === child.id);
        if (
          nftDb?.children &&
          nftDb?.children.length > 0
        ) {
          await this.updateNFTChildrenRootOwner(
            nftDb,
            rootowner || nft.rootowner,
            (level || 1) + 1
          );
        }
        this.db.chain = _.chain(this.db.data)
        this.db.chain.get("nfts").find(({ id }) => id === child.id).assign({
          ...nftDb,
          forsale: BigInt(0),
          rootowner: rootowner || nft.rootowner,
        }).value();
      });
      await Promise.all(promises);
      await this.db.write();
    }
  }

  public async updateNFTBuy(nft: NFT, consolidatedNFT: NFTConsolidated): Promise<void> {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
      ...nftDb,
      owner: nft?.owner,
      rootowner: nft?.rootowner,
      changes: nft?.changes,
      forsale: nft?.forsale,
    }).value();
    await this.db.write();
  }

  public async updateNFTSend(nft: NFT, consolidatedNFT: NFTConsolidated): Promise<void> {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
      ...nftDb,
      changes: nft?.changes,
      owner: nft?.owner,
      rootowner: nft?.rootowner,
      forsale: BigInt(0),
      pending: nft?.pending,
    }).value();
    await this.db.write();
  }

  public async updateNFTBurn(
    nft: NFT | NFTConsolidated,
    consolidatedNFT: NFTConsolidated
  ): Promise<void> {
    await this.db.read();
    let nftDb: NFTConsolidated = this.db.data.nfts.find(({ id }) => id === consolidatedNFT.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("nfts").find(({ id }) => id === consolidatedNFT.id).assign({
      ...nftDb,
      burned: nft?.burned,
      changes: nft?.changes,
      equipped: "",
      forsale: BigInt(nft.forsale) > BigInt(0) ? BigInt(0) : nft.forsale,
    }).value();
    await this.db.write();
  }

  public async updateNFTMint(nft: NFT): Promise<void> {
    await this.db.read();
    this.db.data.nfts.push({
      ...nft,
      symbol: nft.symbol,
      id: nft.getId(),
    });
    await this.db.write();
  }

  public async updateCollectionMint(collection: CollectionConsolidated) { //: Promise<CollectionConsolidated>
    await this.db.read();
    this.db.data.collections.push(collection);
    await this.db.write();
    const collectionDb = await this.getCollectionById(collection.id);
    return collectionDb
  }

  public async updateCollectionDestroy(collection: CollectionConsolidated) {
    await this.db.read();
    const index = this.db.data.collections.indexOf(collection);
    this.db.data.collections.splice(index, 1);
    await this.db.write();
  }

  public async updateCollectionLock(consolidatedCollection: CollectionConsolidated) {
    const nfts = await this.getNFTsByCollection(consolidatedCollection.id);
    let collectionDb: CollectionConsolidated = this.db.data.collections.find(({ id }) => id === consolidatedCollection.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("collections").find(({ id }) => id === consolidatedCollection.id).assign({
      ...collectionDb,
      max: (nfts || []).filter((nft) => nft.burned === "").length,
    }).value();
    await this.db.write();
    return;
  }

  public async updateBase(base: Base): Promise<BaseConsolidated> {
    await this.db.read();
    let baseDb: BaseConsolidated = this.db.data.bases.find(({ id }) => id === base.getId());
    if (!baseDb) {
      this.db.data.bases.push({
        ...base,
        id: base.getId(),
      });
    }
    else {
      this.db.chain = _.chain(this.db.data)
      this.db.chain.get("bases").find(({ id }) => id === base.getId()).assign({
        ...baseDb,
        id: base.getId(),
      }).value();
    }
    await this.db.write();
    baseDb = await this.getBaseById(base.getId());
    return baseDb
  }

  public async updateBaseThemeAdd(
    base: Base,
    consolidatedBase: BaseConsolidated
  ): Promise<void> {
    await this.db.read();
    let baseDb: BaseConsolidated = this.db.data.bases.find(({ id }) => id === consolidatedBase.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("bases").find(({ id }) => id === consolidatedBase.id).assign({
      ...baseDb,
      themes: base?.themes,
    }).value();
    await this.db.write();
  }

  public async updateCollectionIssuer(
    collection: Collection,
    consolidatedCollection: CollectionConsolidated
  ): Promise<void> {
    await this.db.read();
    let collectionDb: CollectionConsolidated = this.db.data.collections.find(({ id }) => id === consolidatedCollection.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("collections").find(({ id }) => id === consolidatedCollection.id).assign({
      ...collectionDb,
      issuer: collection?.issuer,
      changes: collection?.changes,
    }).value();
    await this.db.write();
  }

  public async updateBaseIssuer(
    base: Base,
    consolidatedBase: BaseConsolidated
  ): Promise<void> {
    await this.db.read();
    let baseDb: BaseConsolidated = this.db.data.bases.find(({ id }) => id === consolidatedBase.id);
    this.db.chain = _.chain(this.db.data)
    this.db.chain.get("bases").find(({ id }) => id === consolidatedBase.id).assign({
      ...baseDb,
      issuer: base?.issuer,
      changes: base?.changes,
    }).value();
    await this.db.write();
  }

  public async getNFTsByCollection(collectionId: string) {
    await this.db.read();
    return this.db.data.nfts.filter((nft) => nft?.collection === collectionId);
  }

  public async getNFTById(NFTId: string): Promise<NFTConsolidated> {
    await this.db.read();
    return this.db.data.nfts.find(({ id }) => id === NFTId);
  }

  public async getCollectionById(collectionId: string): Promise<CollectionConsolidated> {
    await this.db.read();
    return this.db.data.collections.find(({ id }) => id === collectionId);
  }

  /**
   * Find existing NFT by id
   */
  public async getNFTByIdUnique(NFTId: string): Promise<NFTConsolidated> {
    await this.db.read();
    return this.db.data.nfts.find(({ id }) => id === NFTId);
  }

  public async getBaseById(baseId: string): Promise<BaseConsolidated> {
    await this.db.read();
    return this.db.data.bases.find(({ id }) => id === baseId);
  }
}
