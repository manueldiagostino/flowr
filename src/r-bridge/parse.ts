// TODO: global entrypoint for configuration of the parser and all components

import { RShellSession } from './rshell'
import * as xml2js from 'xml2js'

/**
 * Provides the capability to parse R files using the R parser.
 * Depends on {@link RShellSession} to provide a connection to R.
 */
export async function retrieveXmlFromRCode (filename: string): Promise<string> {
  const session = new RShellSession()

  return await new Promise<string>((resolve, reject) => {
    session.onData(data => {
      resolve(data.toString())
    })

    session.sendCommands('require(xmlparsedata)',
        `parsed_file <- parse(file = "${filename}", keep.source = TRUE)`,
        'xml_parsed_output <- xmlparsedata::xml_parse_data(parsed_file, includeText = TRUE, pretty = FALSE)',
        'cat(xml_parsed_output)'
    )

    // TODO: allow to configure timeout
    setTimeout(() => { reject(new Error('timeout')) }, 5000)
  }).finally(() => { session.close() })
}

// TODO: type ast etc
/**
 * uses {@link #retrieveXmlFromRCode} and returns the nicely formatted object-AST
 */
export async function retrieveAstFromRCode (filename: string): Promise<object> {
  const xml = await retrieveXmlFromRCode(filename)
  return xml2js.parseStringPromise(xml, { validator: undefined /* TODO */ })
}
