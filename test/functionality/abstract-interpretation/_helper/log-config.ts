import { LogLevel } from '../../../../src/util/log';
import { setMinLevelOfAllLogs } from '../../_helper/log';

/**
 * Get the log level from the LOG_LEVEL environment variable.
 * Supports: trace, debug, info, warn, error
 * Case-insensitive.
 * Defaults to Error if unset or invalid.
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

// Apply the log level immediately when this module is imported
setMinLevelOfAllLogs(getLogLevelFromEnv(), !!process.env.LOG_LEVEL);
