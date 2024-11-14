import { processCommandLineArgs } from './common/script';
import { guard } from '../util/assert';


export interface AbsIntCliOptions {
    verbose:             boolean
	help:                boolean
	input:               string | undefined
	output:              string | undefined
    'input-is-text':     boolean
	stats:               boolean
    domain:              string
}

const options = processCommandLineArgs<AbsIntCliOptions>('absInt', ['domain', 'input'], {
	subtitle: 'Perform Abstract Interpretation Analysis',
	examples: [
		'{bold -d} {italic "sign"} {bold -i} {italic test/testfiles/example.R}',
		'{bold -d} {italic "sign"} {bold -i} {italic "example.R"} {bold --stats}',
		'{bold -d} {italic "sign"} {bold -r} {italic "a <- 3\\\\nb <- 4\\\\nprint(a)"}',
		'{bold --help}'
	]
});


async function getAbSint() {

    const AbsIntExecutor = true;

    guard(options.input !== undefined, 'The input must be specified');
    guard(options.domain !== undefined, 'An abstract domain must be specified');
    
    console.log("Make AbsInt");

}

void getAbSint();
