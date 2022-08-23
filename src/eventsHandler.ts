import { handleReferendumEnd } from "./handleReferendumEnd.js";

async function handleEventWithoutExtrinsic(
  blockIndexer,
  event,
  eventSort,
  blockEvents
) {
  const indexer = {
    ...blockIndexer,
    eventIndex: eventSort,
  };

  await handleReferendumEnd(event, indexer);
}

export const handleEvents = async (events, extrinsics, blockIndexer) => {
  for (let sort = 0; sort < events.length; sort++) {
    const { event } = events[sort];
    await handleEventWithoutExtrinsic(blockIndexer, event, sort, events);
    continue;
  }
};