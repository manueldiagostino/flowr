import { processCommandLineArgs } from './common/script';
import { guard } from '../util/assert';
import { SignLattice } from '../absInt/analysis/nonrelational/value/sign/sign-lattice';


export interface AbsIntCliOptions {
    verbose:         boolean
	help:               boolean
	input:              string | undefined
	output:             string | undefined
    'input-is-text': boolean
	stats:              boolean
    domain:          string
}

const options = processCommandLineArgs<AbsIntCliOptions>('abs-int', ['domain', 'input'], {
	subtitle: 'Perform Abstract Interpretation Analysis',
	examples: [
		'{bold -d} {italic "sign"} {bold -i} {italic test/testfiles/example.R}',
		'{bold -d} {italic "sign"} {bold -i} {italic "example.R"} {bold --stats}',
		'{bold -d} {italic "sign"} {bold -r} {italic "a <- 3\\\\nb <- 4\\\\nprint(a)"}',
		'{bold --help}'
	]
});


/*async*/ function getAbsInt() {
	const _AbsIntExecutor: boolean = true;
	const _l: SignLattice = new SignLattice(); // Aggiungi il tipo esplicito per SignLattice

	try {
		guard(options.input !== undefined, 'The input must be specified');
		guard(options.domain !== undefined, 'An abstract domain must be specified');
	} catch(error: unknown) {
		if(error instanceof Error) {
			console.error(error.message);
		} else {
			console.error('An unknown error occurred');
		}
	}

	console.log('Make AbsInt');
}

void getAbsInt();
