import * as path from 'path';
import { parse as parseStackTrace } from 'stack-trace';
import { stringify } from 'mocha/lib/utils';
import { createPatch } from 'diff';
import { TestEvent, TestSuiteEvent, TestDecoration } from 'vscode-test-adapter-api';

export default (sendMessage: (message: any) => void) => {

	return class Reporter {

		constructor(runner: Mocha.IRunner) {

			const startTimes = new Map<string, number>();

			function getElapsedTime(id: string): string | undefined {

				if (startTimes.has(id)) {

					const elapsed = Date.now() - startTimes.get(id)!;
					startTimes.delete(id);
					return `${elapsed}ms`;

				} else {
					return undefined;
				}
			}

			runner.on('suite', (suite: Mocha.ISuite) => {

				const suiteId = `${suite.file}: ${suite.fullTitle()}`;
				startTimes.set(suiteId, Date.now());

				const event: TestSuiteEvent = {
					type: 'suite',
					suite: suiteId,
					state: 'running'
				};

				sendMessage(event);
			});

			runner.on('suite end', (suite: Mocha.ISuite) => {

				const suiteId = `${suite.file}: ${suite.fullTitle()}`;
				const description = getElapsedTime(suiteId);

				const event: TestSuiteEvent = {
					type: 'suite',
					suite: suiteId,
					state: 'completed',
					description
				};

				sendMessage(event);
			});

			runner.on('test', (test: Mocha.ITest) => {

				const testId = `${test.file}: ${test.fullTitle()}`;
				startTimes.set(testId, Date.now());

				const event: TestEvent = {
					type: 'test',
					test: testId,
					state: 'running'
				};

				sendMessage(event);
			});

			runner.on('pass', (test: Mocha.ITest) => {

				const testId = `${test.file}: ${test.fullTitle()}`;
				const description = getElapsedTime(testId);

				const event: TestEvent = {
					type: 'test',
					test: testId,
					state: 'passed',
					description
				};

				sendMessage(event);
			});

			runner.on('fail', (test: Mocha.ITest, err: Error & { actual?: any, expected?: any, showDiff?: boolean }) => {

				const testId = `${test.file}: ${test.fullTitle()}`;
				const description = getElapsedTime(testId);

				let decorations: TestDecoration[] = [];
				if (err.stack) {
					const parsedStack = parseStackTrace(err);
					for (const stackFrame of parsedStack) {
						const filename = stackFrame.getFileName();
						if (typeof filename === 'string') {
							if (path.resolve(filename) === test.file) {
								decorations.push({
									line: stackFrame.getLineNumber() - 1,
									message: err.message
								});
								break;
							}
						}
					}
				}

				let message = err.stack || err.message;

				if ((err.showDiff !== false) && 
					sameType(err.actual, err.expected) && 
					(err.expected !== undefined)) {

					const actualString = stringify(err.actual);
					const expectedString = stringify(err.expected);
					let diff = createPatch('string', actualString, expectedString, '', '');
					diff = diff
						.split('\n')
						.splice(5)
						.filter(line => !line.match(/\\ No newline/))
						.join('\n');

					message += '\n\n+ expected - actual\n\n' + diff;
				}

				const event: TestEvent = {
					type: 'test',
					test: `${test.file}: ${test.fullTitle()}`,
					state: 'failed',
					message,
					decorations,
					description
				};

				sendMessage(event);
			});

			runner.on('pending', (test: Mocha.ITest) => {

				const testId = `${test.file}: ${test.fullTitle()}`;
				startTimes.delete(testId);

				const event: TestEvent = {
					type: 'test',
					test: testId,
					state: 'skipped',
					description: ''
				};

				sendMessage(event);
			});
		}
	}
}

function sameType(a: any, b: any): boolean {
	return Object.prototype.toString.call(a) === Object.prototype.toString.call(b);
}
