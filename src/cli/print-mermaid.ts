/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { processCommandLineArgs } from './common/script';
import { guard } from '../util/assert';
import { PipelineExecutor } from '../core/pipeline-executor';
import { DEFAULT_ABSINT_PIPELINE } from '../core/steps/pipeline/default-pipelines';
import { RShell } from '../r-bridge/shell';
import * as fs from 'fs';
import { normalizedAstToMermaid } from '../util/mermaid/ast';


export interface PrintMermaidCliOptions {
	verbose:         boolean;
	help:            boolean;
	input:           string | undefined;
	output:          string | undefined;
	'input-is-text': boolean;
	stats:           boolean;
	domain:          string;
}
const options = processCommandLineArgs<PrintMermaidCliOptions>('abs-int', ['output', 'input'], {
	subtitle: 'Perform Abstract Interpretation Analysis',
	examples: [
		'{bold -i} {italic "test/testfiles/example.R"} {bold -o} {italic "tmp/output.mmd"}',
		'{bold -i} {italic "example.R"} {bold -o} {italic "output.mmd"} {bold --stats}',
	],
});

async function getAbsInt() {

	guard(options.input !== undefined, 'The input must be specified');
	guard(options.output !== undefined, 'An output must be specified');
	
	const shell = new RShell();
	try {
		const pipeline = new PipelineExecutor(DEFAULT_ABSINT_PIPELINE, {
			shell,
			domain:  'sign',
			request: options['input-is-text']
				? { request: 'text', content: options.input }
				: { request: 'file', content: options.input },
		});

		const result = await pipeline.allRemainingSteps();
		const normalizedAST = result.normalize.ast;
		const mermaidCode = normalizedAstToMermaid(normalizedAST);

		const mermaidFilePath = options.output;

		// Creare la directory se non esiste
		// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-call
		const dir = require('path').dirname(mermaidFilePath);
		if(!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		fs.writeFileSync(mermaidFilePath, mermaidCode, 'utf8');
		console.log(`Mermaid diagram exported to ${mermaidFilePath}`);
		// console.log(JSON.stringify(normalizedAST, null, 2));
	} catch(error) {
		console.error('Error in abs-int: ' + (error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
	} finally {
		if(shell) {
			try {
				shell.close();
			} catch(closeError) {
				console.error('Failed to close shell');
			}
		}
	}
}
getAbsInt().then(() => {
	console.log('Mermaid printed successfully');
}).catch((error) => {
	console.error('Error', error);
	process.exitCode = 1;
});
