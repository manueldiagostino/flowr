import { processCommandLineArgs } from './common/script';
import { guard } from '../util/assert';
import { PipelineExecutor } from '../core/pipeline-executor';
import { DEFAULT_ABSINT_PIPELINE } from '../core/steps/pipeline/default-pipelines';
import { RShell } from '../r-bridge/shell';
import { SignAnalysis } from '../abstract-interpretation/analysis/nonrelational/value/sign/sign-analysis';
import { normalizedAstToMermaid } from '../util/mermaid/ast';


export interface AbsIntCliOptions {
	verbose:         boolean;
	help:            boolean;
	input:           string | undefined;
	output:          string | undefined;
	'input-is-text': boolean;
	stats:           boolean;
	domain:          string;
}
const options = processCommandLineArgs<AbsIntCliOptions>('abs-int', ['domain', 'input'], {
	subtitle: 'Perform Abstract Interpretation Analysis',
	examples: [
		'{bold -d} {italic "sign"} {bold -i} {italic test/testfiles/example.R}',
		'{bold -d} {italic "sign"} {bold -i} {italic "example.R"} {bold --stats}',
		'{bold -d} {italic "sign"} {bold -r} {italic "a <- 3\\\\nb <- 4\\\\nprint(a)"}',
		'{bold --help}',
	],
});

async function getAbsInt() {
	guard(options.input !== undefined, 'The input must be specified');
	guard(options.domain !== undefined, 'An abstract domain must be specified');
	const shell = new RShell();
	try {
		const pipeline = new PipelineExecutor(DEFAULT_ABSINT_PIPELINE, {
			shell,
			domain:  options.domain,
			request: options['input-is-text']
				? { request: 'text', content: options.input }
				: { request: 'file', content: options.input },
		});
		const result = await pipeline.allRemainingSteps();
		const normalizedAST = result.normalize.ast;
		const _mermaidCode = normalizedAstToMermaid(normalizedAST);

		const _mermaidFilePath = './normalizedAST.mmd';

		// Scrivi il codice Mermaid in un file
		// fs.writeFileSync(mermaidFilePath, mermaidCode, 'utf8');
		// console.log(`Mermaid diagram exported to ${mermaidFilePath}`);
		// console.log(JSON.stringify(normalizedAST, null, 2));

		const signAnalysis = new SignAnalysis();
		console.log('Calling the fold method');
		signAnalysis.fold(normalizedAST);
		console.log(signAnalysis.getJSONInvariants());
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
	console.log('Abstract analysis completed successfully');
}).catch((error) => {
	console.error('Error during Abstract Interpretation:', error);
	process.exitCode = 1;
});
