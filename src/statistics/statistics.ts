import {
  retrieveXmlFromRCode,
  RParseRequest,
  RParseRequestFromFile,
  RParseRequestFromText
} from '../r-bridge/retriever'
import { ALL_FEATURES, FeatureKey, FeatureStatistics, InitialFeatureStatistics } from './feature'
import { RShell } from '../r-bridge/shell'
import { DOMParser } from 'xmldom'

export async function extractSingle(result: FeatureStatistics, shell: RShell, from: RParseRequest, features: 'all' | Set<FeatureKey>): Promise<FeatureStatistics> {
  const xml = await retrieveXmlFromRCode(from, shell)
  const doc = new DOMParser().parseFromString(xml, 'text/xml')

  for (const [key, feature] of Object.entries(ALL_FEATURES)) {
    if(features !== 'all' && !features.has(key as FeatureKey)) {
      continue
    }
    // eslint-disable-nex-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error object.entries does not retain the type information
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    result[key] = feature.append(result[key], doc)
  }

  return result
}

/**
 * extract all statistic information from a set of requests using the presented R session
 */
export async function extract<T extends RParseRequestFromText | RParseRequestFromFile>(shell: RShell,
                                                                                       onRequest: (request: T) => void,
                                                                                       features: 'all' | Set<FeatureKey>,
                                                                                       ...requests: T[]
): Promise<FeatureStatistics> {
  let result = InitialFeatureStatistics()
  // TODO: allow to differentiate between testfolder and no testfolder
  let first = true
  const skipped = []
  for(const request of requests) {
    onRequest(request)
    try {
      result = await extractSingle(result, shell, {
        ...request,
        attachSourceInformation: true,
        ensurePackageInstalled:  first
      }, features)
      first = false
    } catch (e) {
      console.error('for request: ', request, e)
      skipped.push(request)
    }
  }
  console.warn(`skipped ${skipped.length} requests due to errors (run with logs to get more info)`)
  return result
}



