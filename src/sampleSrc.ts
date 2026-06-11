/**
 * Resolve sample filepaths to browser-loadable URLs for hover thumbnails.
 *
 * `getSampleSrc` passes any `scheme://` path through unchanged, which
 * breaks cloud URIs (`gs://`, `s3://`, …) in `<img src>`. Those schemes
 * must go through the App media proxy instead.
 */

import * as fos from '@fiftyone/state';
import { getFetchParameters } from '@fiftyone/utilities';

const CLOUD_STORAGE_SCHEMES = /^(gs|gcp|s3|az|azure):\/\//i;

function mediaProxyUrl(filepath: string): string {
  const params = getFetchParameters();
  const path = `${params.pathPrefix}/media`.replace(/\/\//g, '/');
  return `${params.origin}${path}?filepath=${encodeURIComponent(filepath)}`;
}

export function getHoverSampleSrc(filepath: string): string {
  if (CLOUD_STORAGE_SCHEMES.test(filepath)) {
    return mediaProxyUrl(filepath);
  }
  return fos.getSampleSrc(filepath) as string;
}
