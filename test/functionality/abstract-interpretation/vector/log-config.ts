import { LogLevel, log } from '../../../../src/util/log';
import { absintLogger } from '../../../../src/abstract-interpretation/logger';
import { vectorLogger } from '../../../../src/abstract-interpretation/vector/logger';

/**
 * Auto-configured log levels for vector tests.
 *
 * Configures both absintLogger and vectorLogger (sub-logger of absint)
 * to output to terminal and file based on the test command:
 *
 * - `npm run test:file -- <file>`        → LogLevel.Error (default)
 * - `npm run test:file:debug -- <file>`  → LogLevel.Debug
 * - `npm run test:file:trace -- <file>`  → LogLevel.Trace
 *
 * Logs are written to /tmp/flowr.log when LOG_LEVEL is set.
 *
 * Set FLOWR_LOG_SIMPLE=1 to hide metadata (timestamp, log level, file path)
 * and show only the message content.
 */
function getLogLevelFromEnv(): LogLevel {
	const level = process.env.LOG_LEVEL?.toLowerCase();
	switch(level) {
		case 'trace': return LogLevel.Trace;
		case 'debug': return LogLevel.Debug;
		case 'info': return LogLevel.Info;
		case 'warn': return LogLevel.Warn;
		case 'error': return LogLevel.Error;
		default: return LogLevel.Error;
	}
}

const logLevel = getLogLevelFromEnv();
const isLogLevelExplicitlySet = !!process.env.LOG_LEVEL;
const isSimpleLog = process.env.FLOWR_LOG_SIMPLE === '1';
const logTemplate = '{{fileNameWithLine}}: ';

// Configure both absint and vector loggers
absintLogger.settings.minLevel = logLevel;
vectorLogger.settings.minLevel = logLevel;

// Hide metadata prefix (timestamp, log level, file path) when FLOWR_LOG_SIMPLE is set
if(isSimpleLog) {
	absintLogger.settings.prettyLogTemplate = logTemplate;
	vectorLogger.settings.prettyLogTemplate = logTemplate;
}

// Enable file logging when LOG_LEVEL is explicitly set
if(isLogLevelExplicitlySet) {
	log.logToFile('/tmp/flowr.log');
}
