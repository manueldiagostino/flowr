import type { BaseQueryFormat, BaseQueryResult } from '../../base-query-format';
import type { NodeId } from '../../../r-bridge/lang-4.x/ast/model/processing/node-id';
import type { QueryResults, SupportedQuery } from '../../query';
import { bold } from '../../../util/ansi';
import { printAsMs } from '../../../util/time';
import Joi from 'joi';
import { executeDependenciesQuery } from './dependencies-query-executor';

// these lists are originally based on https://github.com/duncantl/CodeDepends/blob/7fd96dfee16b252e5f642c77a7ababf48e9326f8/R/codeTypes.R
export const LibraryFunctions: FunctionInfo[] = [
	{ name: 'library',           argIdx: 0, argName: 'package' },
	{ name: 'require',           argIdx: 0, argName: 'package' },
	{ name: 'loadNamespace',     argIdx: 0, argName: 'package' },
	{ name: 'attachNamespace',   argIdx: 0, argName: 'ns' },
	{ name: 'attach',            argIdx: 0, argName: 'what' },
	{ name: 'groundhog.library', argIdx: 0, argName: 'pkg' },
	{ name: 'p_load',            argIdx: 'unnamed' }, // pacman
	{ name: 'p_load_gh',         argIdx: 'unnamed' }, // pacman
	{ name: 'from_import',       argIdx: 0, argName: 'package' }, // easypackages
	{ name: 'libraries',         argIdx: 'unnamed' }, // easypackages
	{ name: 'shelf',             argIdx: 'unnamed' } // librarian
] as const;
export const SourceFunctions: FunctionInfo[] = [
	{ name: 'source', argIdx: 0, argName: 'file' },
	{ name: 'sys.source', argIdx: 0, argName: 'file' }
] as const;
export const ReadFunctions: FunctionInfo[] = [
	{ name: 'read.table', argIdx: 0, argName: 'file' },
	{ name: 'read.csv', argIdx: 0, argName: 'file' },
	{ name: 'read.csv2', argIdx: 0, argName: 'file' },
	{ name: 'read.delim', argIdx: 0, argName: 'file' },
	{ name: 'read.dcf', argIdx: 0, argName: 'file' },
	{ name: 'scan', argIdx: 0, argName: 'file' },
	{ name: 'read.fwf', argIdx: 0, argName: 'file' },
	{ name: 'file', argIdx: 1, argName: 'open' },
	{ name: 'url', argIdx: 1, argName: 'open' },
	{ name: 'load', argIdx: 0, argName: 'file' },
	{ name: 'gzfile', argIdx: 1, argName: 'open' },
	{ name: 'bzfile', argIdx: 1, argName: 'open' },
	{ name: 'download.file', argIdx: 0, argName: 'url' },
	{ name: 'pipe', argIdx: 1, argName: 'open' },
	{ name: 'fifo', argIdx: 1, argName: 'open' },
	{ name: 'unz', argIdx: 1, argName: 'open' },
	{ name: 'matrix', argIdx: 0, argName: 'data' },
	{ name: 'readRDS', argIdx: 0, argName: 'file' },
	{ name: 'readLines', argIdx: 0, argName: 'con' },
	{ name: 'readRenviron', argIdx: 0, argName: 'path' },
	// readr
	{ name: 'read_csv', argIdx: 0, argName: 'file' },
	{ name: 'read_csv2', argIdx: 0, argName: 'file' },
	{ name: 'read_lines', argIdx: 0, argName: 'file' },
	{ name: 'read_delim', argIdx: 0, argName: 'file' },
	{ name: 'read_dsv', argIdx: 0, argName: 'file' },
	{ name: 'read_fwf', argIdx: 0, argName: 'file' },
	{ name: 'read_tsv', argIdx: 0, argName: 'file' },
	{ name: 'read_table', argIdx: 0, argName: 'file' },
	{ name: 'read_log', argIdx: 0, argName: 'file' },
	{ name: 'read_lines', argIdx: 0, argName: 'file' },
	{ name: 'read_lines_chunked', argIdx: 0, argName: 'file' },
	// xlsx
	{ name: 'read.xlsx', argIdx: 0, argName: 'file' },
	{ name: 'read.xlsx2', argIdx: 0, argName: 'file' },
	// data.table
	{ name: 'fread', argIdx: 0, argName: 'file' },
	// haven
	{ name: 'read_sas', argIdx: 0, argName: 'file' },
	{ name: 'read_sav', argIdx: 0, argName: 'file' },
	{ name: 'read_por', argIdx: 0, argName: 'file' },
	{ name: 'read_dta', argIdx: 0, argName: 'file' },
	{ name: 'read_xpt', argIdx: 0, argName: 'file' },
	// feather
	{ name: 'read_feather', argIdx: 0, argName: 'file' },
	// foreign
	{ name: 'read.arff', argIdx: 0, argName: 'file' },
	{ name: 'read.dbf', argIdx: 0, argName: 'file' },
	{ name: 'read.dta', argIdx: 0, argName: 'file' },
	{ name: 'read.epiinfo', argIdx: 0, argName: 'file' },
	{ name: 'read.mtp', argIdx: 0, argName: 'file' },
	{ name: 'read.octave', argIdx: 0, argName: 'file' },
	{ name: 'read.spss', argIdx: 0, argName: 'file' },
	{ name: 'read.ssd', argIdx: 0, argName: 'file' },
	{ name: 'read.systat', argIdx: 0, argName: 'file' },
	{ name: 'read.xport', argIdx: 0, argName: 'file' },
] as const;
export const WriteFunctions: FunctionInfo[] = [
	{ name: 'save', argIdx: 0, argName: '...' },
	{ name: 'save.image', argIdx: 0, argName: 'file' },
	{ name: 'write', argIdx: 1, argName: 'file' },
	{ name: 'dput', argIdx: 1, argName: 'file' },
	{ name: 'dump', argIdx: 1, argName: 'file' },
	{ name: 'write.table', argIdx: 1, argName: 'file' },
	{ name: 'write.csv', argIdx: 1, argName: 'file' },
	{ name: 'saveRDS', argIdx: 1, argName: 'file' },
	// write functions that don't have argIndex are assumed to write to stdout
	{ name: 'print', linkTo: 'sink' },
	{ name: 'cat', linkTo: 'sink', argIdx: 1, argName: 'file' },
	{ name: 'message', linkTo: 'sink' },
	{ name: 'warning', linkTo: 'sink' },
	// readr
	{ name: 'write_csv', argIdx: 1, argName: 'file' },
	{ name: 'write_csv2', argIdx: 1, argName: 'file' },
	{ name: 'write_delim', argIdx: 1, argName: 'file' },
	{ name: 'write_dsv', argIdx: 1, argName: 'file' },
	{ name: 'write_fwf', argIdx: 1, argName: 'file' },
	{ name: 'write_tsv', argIdx: 1, argName: 'file' },
	{ name: 'write_table', argIdx: 1, argName: 'file' },
	{ name: 'write_log', argIdx: 1, argName: 'file' },
	// heaven
	{ name: 'write_sas', argIdx: 1, argName: 'file' },
	{ name: 'write_sav', argIdx: 1, argName: 'file' },
	{ name: 'write_por', argIdx: 1, argName: 'file' },
	{ name: 'write_dta', argIdx: 1, argName: 'file' },
	{ name: 'write_xpt', argIdx: 1, argName: 'file' },
	// feather
	{ name: 'write_feather', argIdx: 1, argName: 'file' },
	// foreign
	{ name: 'write.arff', argIdx: 1, argName: 'file' },
	{ name: 'write.dbf', argIdx: 1, argName: 'file' },
	{ name: 'write.dta', argIdx: 1, argName: 'file' },
	{ name: 'write.foreign', argIdx: 1, argName: 'file' },
	// xlsx
	{ name: 'write.xlsx', argIdx: 1, argName: 'file' },
	{ name: 'write.xlsx2', argIdx: 1, argName: 'file' },
	// graphics
	{ name: 'pdf', argIdx: 0, argName: 'file' },
	{ name: 'jpeg', argIdx: 0, argName: 'file' },
	{ name: 'png', argIdx: 0, argName: 'file' },
	{ name: 'windows', argIdx: 0, argName: 'file' },
	{ name: 'postscript', argIdx: 0, argName: 'file' },
	{ name: 'xfix', argIdx: 0, argName: 'file' },
	{ name: 'bitmap', argIdx: 0, argName: 'file' },
	{ name: 'pictex', argIdx: 0, argName: 'file' },
	{ name: 'cairo_pdf', argIdx: 0, argName: 'file' },
	{ name: 'svg', argIdx: 0, argName: 'file' },
	{ name: 'bmp', argIdx: 0, argName: 'file' },
	{ name: 'tiff', argIdx: 0, argName: 'file' },
	{ name: 'X11', argIdx: 0, argName: 'file' },
	{ name: 'quartz', argIdx: 0, argName: 'file' },
] as const;

export interface FunctionInfo {
    name:     string
    argIdx?:  number | 'unnamed'
    argName?: string
    linkTo?:  string
}

export interface DependenciesQuery extends BaseQueryFormat {
    readonly type:                    'dependencies'
    readonly ignoreDefaultFunctions?: boolean
    readonly libraryFunctions?:       FunctionInfo[]
    readonly sourceFunctions?:        FunctionInfo[]
    readonly readFunctions?:          FunctionInfo[]
    readonly writeFunctions?:         FunctionInfo[]
}

export interface DependenciesQueryResult extends BaseQueryResult {
    libraries:    LibraryInfo[]
    sourcedFiles: SourceInfo[]
    readData:     ReadInfo[]
    writtenData:  WriteInfo[]
}

export interface DependencyInfo extends Record<string, unknown>{
    nodeId:       NodeId
    functionName: string
    linkedIds?:   readonly NodeId[]
}
export type LibraryInfo = (DependencyInfo & { libraryName: 'unknown' | string })
export type SourceInfo = (DependencyInfo & { file: string })
export type ReadInfo = (DependencyInfo & { source: string })
export type WriteInfo = (DependencyInfo & { destination: 'stdout' | string })

function printResultSection<T extends DependencyInfo>(title: string, infos: T[], result: string[], sectionSpecifics: (info: T) => string): void {
	if(infos.length <= 0) {
		return;
	}
	result.push(`   ╰ ${title}`);
	const grouped = infos.reduce(function(groups: Map<string, T[]>, i) {
		const array = groups.get(i.functionName);
		if(array) {
			array.push(i);
		} else {
			groups.set(i.functionName, [i]);
		}
		return groups;
	}, new Map<string, T[]>());
	for(const [functionName, infos] of grouped) {
		result.push(`       ╰ \`${functionName}\``);
		result.push(infos.map(i => `           ╰ Node Id: ${i.nodeId}, ${sectionSpecifics(i)}`).join('\n'));
	}
}

const functionInfoSchema: Joi.ArraySchema = Joi.array().items(Joi.object({
	name:    Joi.string().required().description('The name of the library function.'),
	argIdx:  Joi.number().optional().description('The index of the argument that contains the library name.'),
	argName: Joi.string().optional().description('The name of the argument that contains the library name.'),
})).optional();

export const DependenciesQueryDefinition = {
	executor:        executeDependenciesQuery,
	asciiSummarizer: (formatter, _processed, queryResults, result) => {
		const out = queryResults as QueryResults<'dependencies'>['dependencies'];
		result.push(`Query: ${bold('dependencies', formatter)} (${printAsMs(out['.meta'].timing, 0)})`);
		printResultSection('Libraries', out.libraries, result, l => `\`${l.libraryName}\``);
		printResultSection('Sourced Files', out.sourcedFiles, result, s => `\`${s.file}\``);
		printResultSection('Read Data', out.readData, result, r => `\`${r.source}\``);
		printResultSection('Written Data', out.writtenData, result, w => `\`${w.destination}\``);
		return true;
	},
	schema: Joi.object({
		type:                   Joi.string().valid('dependencies').required().description('The type of the query.'),
		ignoreDefaultFunctions: Joi.boolean().optional().description('Should the set of functions that are detected by default be ignored/skipped?'),
		libraryFunctions:       functionInfoSchema.description('The set of library functions to search for.'),
		sourceFunctions:        functionInfoSchema.description('The set of source functions to search for.'),
		readFunctions:          functionInfoSchema.description('The set of data reading functions to search for.'),
		writeFunctions:         functionInfoSchema.description('The set of data writing functions to search for.'),
	}).description('The dependencies query retrieves and returns the set of all dependencies in the dataflow graph, which includes libraries, sourced files, read data, and written data.')
} as const satisfies SupportedQuery<'dependencies'>;