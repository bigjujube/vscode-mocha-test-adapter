import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import RegExpEscape from 'escape-string-regexp';
import { TestSuiteInfo, TestInfo } from 'vscode-test-adapter-api';
import { patchMocha } from './patchMocha';
import { ErrorInfo, WorkerArgs } from '../util';

if (process.send) {
	process.once('message', workerArgs => loadTests(workerArgs, msg => process.send!(msg)));
} else {
	loadTests(process.argv[2], console.log);
}

function loadTests(workerArgs: string, sendMessage: (message: any) => void) {
	let _logEnabled = true;
	try {

		const {
			testFiles,
			mochaPath,
			mochaOpts,
			monkeyPatch,
			logEnabled
		} = <WorkerArgs>JSON.parse(workerArgs);
		_logEnabled = logEnabled;

		const Mocha: typeof import('mocha') = require(mochaPath);

		const cwd = process.cwd();
		module.paths.push(cwd, path.join(cwd, 'node_modules'));
		for (let req of mochaOpts.requires) {

			if (fs.existsSync(req) || fs.existsSync(`${req}.js`)) {
				req = path.resolve(req);
			}

			if (logEnabled) sendMessage(`Trying require('${req}')`);
			require(req);
		}

		const lineSymbol = Symbol('line number');
		if (monkeyPatch) {
			if (logEnabled) sendMessage('Patching Mocha');
			patchMocha(Mocha, mochaOpts.ui, lineSymbol, logEnabled ? sendMessage : undefined);
		}

		const mocha = new Mocha();
		mocha.ui(mochaOpts.ui);

		if (logEnabled) sendMessage('Loading files');
		for (const file of testFiles) {
			mocha.addFile(file);
		}

		mocha.grep('$^');
		mocha.run(() => processTests(mocha.suite, lineSymbol, sendMessage, _logEnabled));

	} catch (err) {
		if (_logEnabled) sendMessage(`Caught error ${util.inspect(err)}`);
		sendMessage(<ErrorInfo>{ type: 'error', errorMessage: util.inspect(err) });
		throw err;
	}
}

function processTests(
	suite: Mocha.ISuite,
	lineSymbol: symbol,
	sendMessage: (message: any) => void,
	logEnabled: boolean
): void {
	try {

		if (logEnabled) sendMessage('Converting tests and suites');
		const fileCache = new Map<string, string>();
		const rootSuite = convertSuite(suite, lineSymbol, fileCache);

		if (rootSuite.children.length > 0) {
			sendMessage(rootSuite);
		} else {
			sendMessage(null);
		}

	} catch (err) {
		if (logEnabled) sendMessage(`Caught error ${util.inspect(err)}`);
		sendMessage(<ErrorInfo>{ type: 'error', errorMessage: util.inspect(err) });
		throw err;
	}
}


function convertSuite(
	suite: Mocha.ISuite,
	lineSymbol: symbol,
	fileCache: Map<string, string>
): TestSuiteInfo {

	const childSuites: TestSuiteInfo[] = suite.suites.map((suite) => convertSuite(suite, lineSymbol, fileCache));
	const childTests: TestInfo[] = suite.tests.map((test) => convertTest(test, lineSymbol, fileCache));
	const children = (<(TestSuiteInfo | TestInfo)[]>childSuites).concat(childTests);
	let line = (<any>suite)[lineSymbol];
	if (line === undefined) {
		line = suite.file ? findLineContaining(suite.title, getFile(suite.file, fileCache)) : undefined;
	}

	return {
		type: 'suite',
		id: `${suite.file}: ${suite.fullTitle()}`,
		label: suite.title,
		file: suite.file,
		line,
		children
	};
}

function convertTest(
	test: Mocha.ITest,
	lineSymbol: symbol,
	fileCache: Map<string, string>
): TestInfo {

	let line = (<any>test)[lineSymbol];
	if (line === undefined) {
		line = test.file ? findLineContaining(test.title, getFile(test.file, fileCache)) : undefined;
	}

	return {
		type: 'test',
		id: `${test.file}: ${test.fullTitle()}`,
		label: test.title,
		file: test.file,
		line,
		skipped: test.pending
	}
}

function getFile(file: string, fileCache: Map<string, string>): string {

	let content = fileCache.get(file);

	if (!content) {
		content = fs.readFileSync(file, 'utf8');
		fileCache.set(file, content);
	}

	return content;
}

function findLineContaining(needle: string, haystack: string | undefined): number | undefined {

	if (!haystack) return undefined;

	const index = haystack.search(RegExpEscape(needle));
	if (index < 0) return undefined;

	return haystack.substr(0, index).split('\n').length - 1;
}
