import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join as joinPath } from 'path';

const baseDir = __dirname;

function getFFmpegVersion() {
    return execSync('ffmpeg -hide_banner -version').toString('utf-8');
}

type PadTypeShort = 'V' | 'A';

interface FilterInfo {
    name: string;
    inputPads: PadTypeShort[] | null;
    outputPads: PadTypeShort[] | null;
    description: string;
    timelineSupport: boolean;
    sliceThreading: boolean;
    commandSupport: boolean;
}

function listFilters() {
    const listFilterResult = execSync('ffmpeg -hide_banner -filters').toString('utf-8');
    const filterNames: FilterInfo[] = [];
    for (const line of listFilterResult.split(/\r\n|\n/)) {
        const match = /([TSC.]{3})\s+(\w+)\s+([AVN|]+)->([AVN|]+)\s+(.*)/.exec(line);
        if (match) {
            filterNames.push({
                timelineSupport: match[1].includes('T'),
                sliceThreading: match[1].includes('S'),
                commandSupport: match[1].includes('C'),
                name: match[2],
                inputPads: match[3] === '|' ? [] : match[3] === 'N' ? null : match[3].split('') as PadTypeShort[],
                outputPads: match[4] === '|' ? [] : match[4] === 'N' ? null : match[4].split('') as PadTypeShort[],
                description: match[5]
            });
        }
    }
    return filterNames;
}

interface FilterDetailedInfo {
    name: string;
    description: string;
    sliceThreading: boolean;
    timelineSupport: boolean;
    inputPads: FilterPadDescription[] | null;
    outputPads: FilterPadDescription[] | null;
    classes: FilterClassInfo[];
}

type PadType = 'video' | 'audio' | 'data' | 'subtitle' | 'attachment';

interface FilterPadDescription {
    name: string;
    type: PadType;
}

interface FilterClassInfo {
    name: string;
    options: FilterClassOption[];
}

interface FilterClassOption {
    name: string;
    type: string;
    description: string;
    defaultValue?: string;
    acceptedValues?: FilterClassOptionConstantInfo[];
    encodingParam: boolean;
    decodingParam: boolean;
    filteringParam: boolean;
    videoParam: boolean;
    audioParam: boolean;
    subtitleParam: boolean;
    export: boolean;
    readonly: boolean;
    bsfParam: boolean;
    runtimeParam: boolean;
    deprecated: boolean;
}

interface FilterClassOptionConstantInfo {
    name: string;
    value: string;
    description: string;
}

function getFilterDetailedInfo(filterName: string) {
    const filterHelpResult = execSync(`ffmpeg -hide_banner -help filter=${filterName}`).toString('utf-8');
    const detailedInfo: FilterDetailedInfo = {
        name: '',
        description: '',
        sliceThreading: false,
        timelineSupport: false,
        inputPads: [],
        outputPads: [],
        classes: []
    };
    let state = 'readName';
    let currentClass: FilterClassInfo | undefined;
    let currentClassOption: FilterClassOption | undefined;
    for (const line of filterHelpResult.split(/\r\n|\n/)) {
        let match: RegExpExecArray | null = null;
        switch (state) {
            case 'readName':
            if (match = /^Filter (.+)/.exec(line)) {
                detailedInfo.name = match[1];
                state = 'readDescription';
            }
            break;

            case 'readDescription':
            if (match = /^\s+(.+)/.exec(line)) {
                detailedInfo.description = match[1];
                state = 'readSliceThreadingFlag';
                break;
            }
            // fallthrough

            case 'readSliceThreadingFlag':
            if (match = /^\s+slice threading supported/.exec(line)) {
                detailedInfo.sliceThreading = true;
                state = 'readInputHead';
                break;
            }
            // fallthrough

            case 'readInputHead':
            if (match = /^\s+Inputs:/.exec(line)) {
                state = 'readInputPad';
                break;
            }
            throw new Error(`Illegal input in state ${state}: ${line}`);

            case 'readInputPad':
            if (match = /^\s+#\d+:\s*(\w+)\s*\((\w+)\)/.exec(line)) {
                detailedInfo.inputPads!.push({
                    name: match[1],
                    type: match[2] as PadType
                });
                break;
            }
            // fallthrough

            case 'readInputDynamic':
            if (match = /^\s+dynamic \(depending on the options\)/.exec(line)) {
                detailedInfo.inputPads = null;
                state = 'readOutputHead';
                break;
            }
            // fallthrough

            case 'readInputNone':
            if (match = /^\s+none \(source filter\)/.exec(line)) {
                detailedInfo.inputPads = [];
                state = 'readOutputHead';
                break;
            }
            // fallthrough

            case 'readOutputHead':
            if (match = /^\s+Outputs:/.exec(line)) {
                state = 'readOutputPad';
                break;
            }
            throw new Error(`Illegal input in state ${state}: ${line}`);

            case 'readOutputPad':
            if (match = /^\s+#\d+:\s*(\w+)\s*\((\w+)\)/.exec(line)) {
                detailedInfo.outputPads!.push({
                    name: match[1],
                    type: match[2] as PadType
                });
                break;
            }
            // fallthrough

            case 'readOutputDynamic':
            if (match = /^\s+dynamic \(depending on the options\)/.exec(line)) {
                detailedInfo.outputPads = null;
                break;
            }
            // fallthrough

            case 'readOutputNone':
            if (match = /^\s+none \(sink filter\)/.exec(line)) {
                detailedInfo.outputPads = [];
                state = 'readAVOptionsHead';
                break;
            }
            // fallthrough

            case 'readAVOptionsHead':
            if (match = /^(.+) AVOptions:/.exec(line)) {
                currentClass = {
                    name: match[1],
                    options: []
                };
                detailedInfo.classes.push(currentClass);
                state = 'readAVOptionsList';
                break;
            }
            // fallthrough

            case 'readTimelineSupport':
            if (match = /^This filter has support for timeline through the 'enable' option\./.exec(line)) {
                detailedInfo.timelineSupport = true;
                state = 'done';
                break;
            }

            case 'readAVOptionSpaces':
            if (line.trim() === '') {
                break;
            }
            throw new Error(`Illegal input in state ${state}: ${line}`);

            case 'readAVOptionsList':
            if (match = /^  (?:-| )?(\S+)\s+<(\S+)>\s+([EDFVASXRBTP.]{11})\s*(.*?)(?:\s+\(default (.+?)\))?\s*$/.exec(line)) {
                currentClassOption = {
                    name: match[1],
                    type: match[2],
                    description: match[4],
                    defaultValue: match[5],
                    encodingParam: match[3].includes('E'),
                    decodingParam: match[3].includes('D'),
                    filteringParam: match[3].includes('F'),
                    videoParam: match[3].includes('V'),
                    audioParam: match[3].includes('A'),
                    subtitleParam: match[3].includes('S'),
                    export: match[3].includes('X'),
                    readonly: match[3].includes('R'),
                    bsfParam: match[3].includes('B'),
                    runtimeParam: match[3].includes('T'),
                    deprecated: match[3].includes('P'),
                };
                currentClass!.options.push(currentClassOption);
                break;
            }
            // fallthrough

            case 'readAVOptionsListSub':
            if (match = /^     (\S+)\s+(\S*)\s*([EDFVASXRBTP.]{11})?\s*(.*)/.exec(line)) {
                if (!currentClassOption!.acceptedValues) {
                    currentClassOption!.acceptedValues = [];
                }
                currentClassOption!.acceptedValues.push({
                    name: match[1],
                    value: match[2],
                    description: match[4]
                });
                break;
            }
            // fallthrough

            case 'readAVOptionsListSpace':
            if (line.trim() === '') {
                state = 'readAVOptionsHead';
                break;
            }
            throw new Error(`Illegal input in state ${state}: ${line}`);
        }
    }
    return detailedInfo;
}

const tab = ' '.repeat(4);

const avTypeToTs: Record<string, string> = {
    flags: 'number',
    int: 'number',
    int64: 'number',
    unsigned: 'number',
    uint64: 'number',
    double: 'number',
    float: 'number',
    string: 'string | number',
    rational: 'string | number',
    binary: 'string',
    dictionary: 'string',
    image_size: 'string',
    video_rate: 'string',
    pix_fmt: 'string',
    sample_fmt: 'string',
    duration: 'string',
    color: 'string',
    channel_layout: 'string',
    boolean: 'boolean'
};

const toPascalCase = (s: string) => s.replace(/(?:^|_|\W)(\w|$)/g, (_, ch) => ch.toUpperCase());
const toCamelCase = (s: string) => s.replace(/(?:_|\W)(\w|$)/g, (_, ch) => ch.toUpperCase());

function template(filterInfo: FilterDetailedInfo) {
    const classOptionsDts: string[] = [];
    const optionArgumentTypes: string[] = [];
    let allOptionsOptional = true;
    for (const filterClass of filterInfo.classes) {
        const classIdentifier = toPascalCase(filterClass.name);
        const optLines: string[] = [];
        optLines.push('/**');
        optLines.push(` * Options for AVClass ${filterClass.name}`);
        optLines.push(' */');
        if (filterClass.options.length > 0) {
            optLines.push(`export interface ${classIdentifier}Options {`);
            for (const optionInfo of filterClass.options) {
                const optCommentLineLines: string[] = [];
                if (optionInfo.description) {
                    optCommentLineLines.push(optionInfo.description);
                }
                if (optionInfo.acceptedValues) {
                    if (optCommentLineLines.length > 0) optCommentLineLines.push('');
                    optCommentLineLines.push('Available values:');
                    for (const valueInfo of optionInfo.acceptedValues) {
                        optCommentLineLines.push(`- "${valueInfo.name}"${valueInfo.description !== '' ? ` - ${valueInfo.description}` : ''}`);
                    }
                }
                if (optionInfo.defaultValue) {
                    if (optCommentLineLines.length > 0) optCommentLineLines.push('');
                    optCommentLineLines.push(`@defaultValue \`${optionInfo.defaultValue}\``);
                } else if (optionInfo.type !== 'binary') {
                    allOptionsOptional = false;
                }
                if (optCommentLineLines.length > 0) {
                    optLines.push(`${tab}/**`);
                    for (const commentLine of optCommentLineLines) {
                        optLines.push(`${tab} * ${commentLine}`);
                    }
                    optLines.push(`${tab} */`);
                }
                let typeStr = avTypeToTs[optionInfo.type] ?? optionInfo.type;
                if (optionInfo.acceptedValues) {
                    typeStr = optionInfo.acceptedValues.map((v) => `"${v.name}"`).join(' | ');
                }
                const escapedName = /^[A-Za-z_]\w*$/.test(optionInfo.name) ? optionInfo.name : JSON.stringify(optionInfo.name);
                const isOptional = optionInfo.defaultValue !== undefined || filterClass.options.some((e) => e.description === optionInfo.description && e !== optionInfo);
                optLines.push(`${tab}${escapedName}${isOptional ? '?' : ''}: ${typeStr};`);
            }
            optLines.push(`}`);
        } else {
            optLines.push(`export interface ${classIdentifier}Options {}`);
        }
        classOptionsDts.push(optLines.join('\n'));
        optionArgumentTypes.push(`${classIdentifier}Options`);
    }
    if (filterInfo.timelineSupport) {
        optionArgumentTypes.push('GenericEnabledOptions');
    }
    const dtsLines: string[] = [];
    const jsLines: string[] = [];
    dtsLines.push(`${tab}${tab}/**`);
    dtsLines.push(`${tab}${tab} * AVFilter \`${filterInfo.name}\`.`);
    dtsLines.push(`${tab}${tab} * ${filterInfo.description}`);
    dtsLines.push(`${tab}${tab} * [Official Documentation](https://ffmpeg.org/ffmpeg-filters.html#${filterInfo.name})`);
    dtsLines.push(`${tab}${tab} */`);
    const dtsInputArguments: string[] = [];
    const jsInputArguments: string[] = [];
    const jsPadList: string[] = [];
    if (optionArgumentTypes.length > 0) {
        const optionArgumentUnionType = optionArgumentTypes.join(' & ');
        const optionArgumentIntersectionType = `${optionArgumentTypes.length > 1 ? `(${optionArgumentUnionType})` : optionArgumentUnionType} | FilterArgument`;
        dtsInputArguments.push(`options${allOptionsOptional ? '?' : ''}: ${optionArgumentIntersectionType}`);
        jsInputArguments.push('options');
    }
    if (filterInfo.inputPads) {
        for (const inputPad of filterInfo.inputPads) {
            const argumentName = `${inputPad.type}${toPascalCase(inputPad.name)}`;
            dtsInputArguments.splice(dtsInputArguments.length - 1, 0, `${argumentName}: Pipe`);
            jsInputArguments.splice(jsInputArguments.length - 1, 0, argumentName);
            jsPadList.push(`${argumentName}.mark('${inputPad.type}')`);
        }
    } else {
        dtsInputArguments.push('...pads: Pipe[]');
        jsInputArguments.push('...pads');
        jsPadList.push('...pads');
    }
    const filterIdentifier = toCamelCase(filterInfo.name);
    jsLines.push(`FilterComplexContext.${filterIdentifier} = function(${jsInputArguments.join(', ')}) {`);
    jsLines.push(`${tab}const filter = this.filter.${filterInfo.name}(${jsInputArguments.includes('options') ? 'options' : ''});`);
    if (jsPadList.length > 0) {
        jsLines.push(`${tab}const chain = this.from(${jsPadList.join(', ')}).pipe(filter);`);
    } else {
        jsLines.push(`${tab}const chain = this.use(filter);`);
    }
    let outputType: string;
    if (filterInfo.outputPads) {
        if (filterInfo.outputPads.length === 0) {
            outputType = 'void';
        } else if (filterInfo.outputPads.length === 1) {
            outputType = 'Pipe';
            const returnPad = filterInfo.outputPads[0];
            const padIdentifier = `out${toPascalCase(returnPad.type)}${toPascalCase(returnPad.name)}`;
            jsLines.push(`${tab}const [${padIdentifier}] = chain;`);
            jsLines.push(`${tab}return ${padIdentifier}.mark('${returnPad.type}');`);
        } else {
            outputType = `[${filterInfo.outputPads.map(() => 'Pipe').join(', ')}]`;
            const returnIdentifiers: string[] = [];
            const returnPadList: string[] = [];
            for (const returnPad of filterInfo.outputPads) {
                const padIdentifier = `out${toPascalCase(returnPad.type)}${toPascalCase(returnPad.name)}`;
                returnIdentifiers.push(padIdentifier);
                returnPadList.push(`${padIdentifier}.mark('${returnPad.type}')`);
            }
            jsLines.push(`${tab}const [${returnIdentifiers.join(', ')}] = chain;`);
            jsLines.push(`${tab}return [${returnPadList.join(', ')}];`);
        }
    } else {
        outputType = 'ChainNode';
        jsLines.push(`${tab}return chain;`);
    }
    dtsLines.push(`${tab}${tab}${filterIdentifier}: (${dtsInputArguments.join(', ')}) => ${outputType};`);
    jsLines.push('}');
    return {
        classOptionsDts,
        filterFunctionDts: dtsLines.join('\n'),
        filterFunctionJs: jsLines.join('\n')
    };
}

const skipList = ['concat', 'split', 'asplit', 'null', 'anull', 'nullsink', 'anullsink'];

function generate() {
    const distDir = joinPath(baseDir, 'dist');
    mkdirSync(distDir, { recursive: true });
    const dtsFile = joinPath(distDir, `index.d.ts`);
    const jsFile = joinPath(distDir, `index.js`);
    const classOptionsDtsCodes = new Set<string>();
    classOptionsDtsCodes.add(`
/**
 * Options for timeline support
 */
export interface GenericEnabledOptions {
    /**
     * An expression which is evaluated before sending a frame to the filter.
     * If the evaluation is non-zero, the filter will be enabled, otherwise
     * the frame will be sent unchanged to the next filter in the filtergraph.
     */
    enabled?: string;
}
    `.trim());
    const dtsLines: string[] = [];
    dtsLines.push(`declare module 'ffmpeg-filter-compose' {`);
    dtsLines.push(`${tab}interface FilterComplexContext {`);
    const jsLines: string[] = [];
    jsLines.push(`'use strict';`);
    jsLines.push(`Object.defineProperty(exports, '__esModule', { value: true });`);
    jsLines.push(`const { FilterComplexContext } = require('ffmpeg-filter-compose');`);
    jsLines.push(`/* ${getFFmpegVersion().trim()} */`);
    for (const { name: filterName } of listFilters()) {
        if (skipList.includes(filterName)) continue;
        const filterInfo = getFilterDetailedInfo(filterName);
        const { classOptionsDts, filterFunctionDts, filterFunctionJs } = template(filterInfo);
        classOptionsDts.forEach((c) => classOptionsDtsCodes.add(c));
        dtsLines.push(filterFunctionDts);
        jsLines.push(filterFunctionJs);
    }
    dtsLines.push(`${tab}}`);
    dtsLines.push(`}`);
    dtsLines.unshift('');
    dtsLines.unshift([...classOptionsDtsCodes].join('\n\n'));
    writeFileSync(dtsFile, dtsLines.join('\n'));
    writeFileSync(jsFile, jsLines.join('\n'));
}

generate();