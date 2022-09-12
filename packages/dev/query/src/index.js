// @flow strict-local
/* eslint-disable monorepo/no-internal-import */
import type {ContentKey} from '@parcel/graph';
import type {PackagedBundleInfo} from '@parcel/core/src/types';

import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import nullthrows from 'nullthrows';
import invariant from 'assert';

const {
  AssetGraph,
  BundleGraph,
  RequestTracker: {
    default: RequestTracker,
    RequestGraph,
    requestGraphEdgeTypes,
  },
} = require('./deep-imports.js');

export function loadGraphs(cacheDir: string): {|
  assetGraph: ?AssetGraph,
  bundleGraph: ?BundleGraph,
  requestTracker: ?RequestTracker,
  bundleInfo: ?Map<ContentKey, PackagedBundleInfo>,
|} {
  function filesBySize() {
    let files = fs
      .readdirSync(cacheDir)
      .map(f => [
        path.join(cacheDir, f),
        fs.statSync(path.join(cacheDir, f)).size,
      ]);

    files.sort(([, a], [, b]) => b - a);

    return files.map(([f]) => f);
  }

  let requestTracker;
  for (let f of filesBySize()) {
    // if (bundleGraph && assetGraph && requestTracker) break;
    if (path.extname(f) !== '') continue;
    try {
      let obj = v8.deserialize(fs.readFileSync(f));
      /* if (obj.assetGraph != null && obj.assetGraph.value.hash != null) {
        assetGraph = AssetGraph.deserialize(obj.assetGraph.value);
      } else if (obj.bundleGraph != null) {
        bundleGraph = BundleGraph.deserialize(obj.bundleGraph.value);
      } else */
      if (obj['$$type']?.endsWith('RequestGraph')) {
        requestTracker = new RequestTracker({
          graph: RequestGraph.deserialize(obj.value),
          // $FlowFixMe
          farm: null,
          // $FlowFixMe
          options: null,
        });
        break;
      }
    } catch (e) {
      // noop
    }
  }

  // Load graphs by finding the main subrequests and loading their results
  let assetGraph, bundleGraph, bundleInfo;

  invariant(requestTracker);
  let buildRequestId = requestTracker.graph.getNodeIdByContentKey(
    'parcel_build_request',
  );
  let buildRequestNode = nullthrows(
    requestTracker.graph.getNode(buildRequestId),
  );
  invariant(
    buildRequestNode.type === 'request' &&
      buildRequestNode.value.type === 'parcel_build_request',
  );
  let subRequests = requestTracker.graph
    .getNodeIdsConnectedFrom(buildRequestId, requestGraphEdgeTypes.subrequest)
    .map(n => nullthrows(requestTracker.graph.getNode(n)));

  let assetGraphRequest = subRequests.find(
    n => n.type === 'request' && n.value.type === 'asset_graph_request',
  );
  if (assetGraphRequest != null) {
    assetGraph = AssetGraph.deserialize(
      loadLargeBlobRequestRequestSync(cacheDir, assetGraphRequest).assetGraph
        .value,
    );
  }

  let bundleGraphRequest = subRequests.find(
    n => n.type === 'request' && n.value.type === 'bundle_graph_request',
  );
  if (bundleGraphRequest != null) {
    bundleGraph = BundleGraph.deserialize(
      loadLargeBlobRequestRequestSync(cacheDir, bundleGraphRequest).bundleGraph
        .value,
    );
  }

  let writeBundlesRequest = subRequests.find(
    n => n.type === 'request' && n.value.type === 'write_bundles_request',
  );
  if (writeBundlesRequest != null) {
    invariant(writeBundlesRequest.type === 'request');
    // $FlowFixMe[incompatible-cast]
    bundleInfo = (nullthrows(writeBundlesRequest.value.result): Map<
      ContentKey,
      PackagedBundleInfo,
    >);
  }

  return {assetGraph, bundleGraph, requestTracker, bundleInfo};
}

function loadLargeBlobRequestRequestSync(cacheDir, node) {
  invariant(node.type === 'request');
  return v8.deserialize(
    fs.readFileSync(path.join(cacheDir, nullthrows(node.value.resultCacheKey))),
  );
}
