import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join as joinPath } from 'path';

const baseDir = __dirname;

function getFFmpegVersion() {
    return execSync('ffmpeg -hide_banner -version').toString('utf-8').trim();
}

const IdentifierRegex = /^[A-Za-z_]\w*$/;

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

interface PixelFormatInfo {
    name: string;
    componentCount: number;
    bitsPerPixel: number;
    bitDepths: number[];
    supportInputConversion: boolean;
    supportOutputConversion: boolean;
    hardwareAccelerated: boolean;
    paletted: boolean;
    bitstream: boolean;
}

function listPixelFormats() {
    const listPixFmtResult = execSync('ffmpeg -hide_banner -pix_fmts').toString('utf-8');
    const pixelFormats: PixelFormatInfo[] = [];
    for (const line of listPixFmtResult.split(/\r\n|\n/)) {
        const match = /([IOHPB.]{5})\s+(\w+)\s+(\d+)\s+(\d+)\s+([\d-]+)/.exec(line);
        if (match) {
            pixelFormats.push({
                supportInputConversion: match[1].includes('I'),
                supportOutputConversion: match[1].includes('O'),
                hardwareAccelerated: match[1].includes('H'),
                paletted: match[1].includes('P'),
                bitstream: match[1].includes('B'),
                name: match[2],
                componentCount: parseInt(match[3], 10),
                bitsPerPixel: parseInt(match[4], 10),
                bitDepths: match[5] === '0' ? [] : match[5].split('-').map((c) => parseInt(c, 10))
            });
        }
    }
    return pixelFormats;
}

interface SampleFormatInfo {
    name: string;
    depth: number;
}

function listSampleFormats() {
    const listSampleFmtResult = execSync('ffmpeg -hide_banner -sample_fmts').toString('utf-8');
    const sampleFormats: SampleFormatInfo[] = [];
    for (const line of listSampleFmtResult.split(/\r\n|\n/)) {
        const match = /(\w+)\s+(\d+)/.exec(line);
        if (match) {
            sampleFormats.push({
                name: match[1],
                depth: parseInt(match[2], 10)
            });
        }
    }
    return sampleFormats;
}

interface ChannelInfo {
    name: string;
    description: string;
}

interface ChannelLayoutInfo {
    name: string;
    channels: ChannelInfo[];
}

function listChannelLayouts() {
    const listLayoutResult = execSync('ffmpeg -hide_banner -layouts').toString('utf-8');
    const channels: Record<string, ChannelInfo> = {};
    const layouts: ChannelLayoutInfo[] = [];
    let readingChannels = true;
    for (const line of listLayoutResult.split(/\r\n|\n/)) {
        if (readingChannels) {
            const match = /(\S+)\s+(.+)/.exec(line);
            if (match) {
                const channelName = match[1];
                if (channelName === 'NAME') continue;
                channels[channelName] = {
                    name: match[1],
                    description: match[2]
                };
            }
        } else {
            const match = /(\S+)\s+(.+)/.exec(line);
            if (match) {
                if (match[1] === 'NAME') continue;
                layouts.push({
                    name: match[1],
                    channels: match[2].split('+').map((ch) => channels[ch])
                });
            }
        }
        if (line.startsWith('Standard channel layouts:')) {
            readingChannels = false;
        }
    }
    return layouts;
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
    pix_fmt: 'PixelFormat',
    sample_fmt: 'SampleFormat',
    duration: 'string',
    color: 'string',
    channel_layout: 'ChannelLayout',
    boolean: 'boolean'
};

const toPascalCase = (s: string) => s.replace(/(?:^|_|\W)(\w|$)/g, (_, ch) => ch.toUpperCase());
const toCamelCase = (s: string) => s.replace(/(?:_|\W)(\w|$)/g, (_, ch) => ch.toUpperCase());
const toFilterDocAnchor = (name: string) => name.replace(/_/g, '_005f');

function filterTemplate(filterInfo: FilterDetailedInfo) {
    const optionArgumentTypes: string[] = [];
    for (const filterClass of filterInfo.classes) {
        if (filterClass.options.length > 0) {
            const classIdentifier = toPascalCase(filterClass.name);
            optionArgumentTypes.push(`${classIdentifier}Options`);
        }
    }
    if (filterInfo.timelineSupport) {
        optionArgumentTypes.push('GenericEnabledOptions');
    }
    const dtsLines: string[] = [];
    const definitionDtsLines: string[] = [];
    const jsLines: string[] = [];
    dtsLines.push(`${tab}${tab}/**`);
    dtsLines.push(`${tab}${tab} * AVFilter \`${filterInfo.name}\`.`);
    dtsLines.push(`${tab}${tab} * ${filterInfo.description}`);
    dtsLines.push(`${tab}${tab} * [Documentation](https://ffmpeg.org/ffmpeg-filters.html#${toFilterDocAnchor(filterInfo.name)})`);
    dtsLines.push(`${tab}${tab} */`);
    definitionDtsLines.push(...dtsLines);
    const dtsInputArguments: string[] = [];
    const jsInputArguments: string[] = [];
    const jsPadList: string[] = [];
    let dtsOptionType: string | undefined;
    if (optionArgumentTypes.length > 0) {
        const optionArgumentUnionType = optionArgumentTypes.join(' & ');
        dtsOptionType = `${optionArgumentTypes.length > 1 ? `(${optionArgumentUnionType})` : optionArgumentUnionType} | FilterArgument`;
        dtsInputArguments.push(`options?: ${dtsOptionType}`);
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
    jsLines.push(`FilterComplexContext.${filterIdentifier} = function ${filterIdentifier}(${jsInputArguments.join(', ')}) {`);
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
    if (dtsOptionType) {
        definitionDtsLines.push(`${tab}${tab}${filterIdentifier}: (options?: ${dtsOptionType}) => Filter;`);
    } else {
        definitionDtsLines.push(`${tab}${tab}${filterIdentifier}: () => Filter;`)
    }
    jsLines.push('}');
    return {
        filterFunctionDts: dtsLines.join('\n'),
        definitionDts: definitionDtsLines.join('\n'),
        filterFunctionJs: jsLines.join('\n')
    };
}

const specialClassLinks: Record<string, string> = {
    'framesync': 'https://ffmpeg.org/ffmpeg-filters.html#Options-for-filters-with-several-inputs-_0028framesync_0029',
    'SWScaler': 'https://ffmpeg.org/ffmpeg-scaler.html#scaler_005foptions',
    'SWResampler': 'https://ffmpeg.org/ffmpeg-resampler.html#Resampler-Options'
};

function classTemplate(name: string, classes: Record<string, FilterClassInfo>) {
    const classDocCommentLinks: string[] = [];
    const classOptionCodes = new Set<string>();
    for (const [filterName, classInfo] of Object.entries(classes)) {
        classDocCommentLinks.push(` * @see https://ffmpeg.org/ffmpeg-filters.html#${toFilterDocAnchor(filterName)}`);
        for (const optionInfo of classInfo.options) {
            const optCommentLineLines: string[] = [];
            const optLines: string[] = [];
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
            const escapedName = IdentifierRegex.test(optionInfo.name) ? optionInfo.name : JSON.stringify(optionInfo.name);
            const isOptional = optionInfo.defaultValue !== undefined || classInfo.options.some((e) => e.description === optionInfo.description && e !== optionInfo);
            optLines.push(`${tab}${escapedName}${isOptional ? '?' : ''}: ${typeStr};`);
            classOptionCodes.add(optLines.join('\n'));
        }
    }
    const classIdentifier = toPascalCase(name);
    const clsLines: string[] = [];
    if (classOptionCodes.size === 0) {
        return '';
    }
    clsLines.push('/**');
    clsLines.push(` * Options for AVClass ${name}.`);
    if (name in specialClassLinks) {
        clsLines.push(` * @see ${specialClassLinks[name]}`);
    } else {
        clsLines.push(...classDocCommentLinks);
    }
    clsLines.push(' */');
    clsLines.push(`export interface ${classIdentifier}Options {`);
    clsLines.push(...classOptionCodes);
    clsLines.push(`}`);
    return clsLines.join('\n');
}

function pixelFormatEnumTemplate(pixelFormats: PixelFormatInfo[]) {
    const dtsLines: string[] = [];
    dtsLines.push(`export enum PixelFormat {`);
    const jsLines: string[] = [];
    jsLines.push(`exports.PixelFormat = {`);
    for (const pixelFormat of pixelFormats) {
        const identifier = IdentifierRegex.test(pixelFormat.name) ? pixelFormat.name : JSON.stringify(pixelFormat.name);
        dtsLines.push(`${tab}${identifier} = ${JSON.stringify(pixelFormat.name)},`);
        jsLines.push(`${tab}${identifier}: ${JSON.stringify(pixelFormat.name)},`);
    }
    dtsLines.push(`}`);
    jsLines.push(`}`);
    return {
        pixFmtEnumDts: dtsLines.join('\n'),
        pixFmtEnumJs: jsLines.join('\n')
    };
}

function sampleFormatEnumTemplate(sampleFormats: SampleFormatInfo[]) {
    const dtsLines: string[] = [];
    dtsLines.push(`export enum SampleFormat {`);
    const jsLines: string[] = [];
    jsLines.push(`exports.SampleFormat = {`);
    for (const sampleFormat of sampleFormats) {
        const identifier = IdentifierRegex.test(sampleFormat.name) ? sampleFormat.name : JSON.stringify(sampleFormat.name);
        dtsLines.push(`${tab}${identifier} = ${JSON.stringify(sampleFormat.name)},`);
        jsLines.push(`${tab}${identifier}: ${JSON.stringify(sampleFormat.name)},`);
    }
    dtsLines.push(`}`);
    jsLines.push(`}`);
    return {
        sampleFmtEnumDts: dtsLines.join('\n'),
        sampleFmtEnumJs: jsLines.join('\n')
    };
}

function channelLayoutEnumTemplate(channelLayouts: ChannelLayoutInfo[]) {
    const dtsLines: string[] = [];
    dtsLines.push(`export enum ChannelLayout {`);
    const jsLines: string[] = [];
    jsLines.push(`exports.ChannelLayout = {`);
    for (const channelLayout of channelLayouts) {
        const identifier = IdentifierRegex.test(channelLayout.name) ? channelLayout.name : channelLayout.name.replace(/\W/g, ' ').trim().replace(/\s+/g, '_');
        dtsLines.push(`${tab}Layout_${identifier} = ${JSON.stringify(channelLayout.name)},`);
        jsLines.push(`${tab}Layout_${identifier}: ${JSON.stringify(channelLayout.name)},`);
    }
    dtsLines.push(`}`);
    jsLines.push(`}`);
    return {
        channelLayoutEnumDts: dtsLines.join('\n'),
        channelLayoutEnumJs: jsLines.join('\n')
    };
}

const skipList = ['concat', 'split', 'asplit', 'null', 'anull', 'nullsink', 'anullsink'];

function generate() {
    const distDir = joinPath(baseDir, 'dist');
    mkdirSync(distDir, { recursive: true });
    const dtsFile = joinPath(distDir, `index.d.ts`);
    const jsFile = joinPath(distDir, `index.js`);
    const dtsLines: string[] = [];
    dtsLines.push(`declare module 'ffmpeg-filter-compose' {`);
    dtsLines.push(`${tab}interface FilterComplexContext {`);
    const jsLines: string[] = [];
    jsLines.push(`'use strict';`);
    jsLines.push(`Object.defineProperty(exports, '__esModule', { value: true });`);
    jsLines.push(`const { FilterComplexContext } = require('ffmpeg-filter-compose');`);
    jsLines.push(`/* ${getFFmpegVersion().replace(/\r\n|\n/g, '\n * ')}\n */`);
    const classMap = new Map<string, Record<string, FilterClassInfo>>();
    const definitionDtsLines: string[] = [];
    for (const { name: filterName } of listFilters()) {
        if (skipList.includes(filterName)) continue;
        const filterInfo = getFilterDetailedInfo(filterName);
        const { filterFunctionDts, definitionDts, filterFunctionJs } = filterTemplate(filterInfo);
        for (const avClass of filterInfo.classes) {
            let classes = classMap.get(avClass.name);
            if (!classes) {
                classMap.set(avClass.name, classes = {});
            }
            classes[filterName] = avClass;
        }
        dtsLines.push(filterFunctionDts);
        definitionDtsLines.push(definitionDts);
        jsLines.push(filterFunctionJs);
    }
    dtsLines.push(`${tab}}`);
    dtsLines.push('');
    dtsLines.push(`${tab}interface FilterMap {`);
    dtsLines.push(...definitionDtsLines);
    dtsLines.push(`${tab}}`);
    dtsLines.push(`}`);
    dtsLines.push('');
    dtsLines.push(`
/**
 * Options for timeline support.
 * @see https://ffmpeg.org/ffmpeg-filters.html#Timeline-editing
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
    for (const [className, classes] of classMap.entries()) {
        const classOptionsCode = classTemplate(className, classes);
        if (classOptionsCode !== '') {
            dtsLines.push('');
            dtsLines.push(classOptionsCode);
        }
    }
    const { pixFmtEnumDts, pixFmtEnumJs } = pixelFormatEnumTemplate(listPixelFormats());
    dtsLines.push('');
    dtsLines.push(pixFmtEnumDts);
    jsLines.push(pixFmtEnumJs);
    const { sampleFmtEnumDts, sampleFmtEnumJs } = sampleFormatEnumTemplate(listSampleFormats());
    dtsLines.push('');
    dtsLines.push(sampleFmtEnumDts);
    jsLines.push(sampleFmtEnumJs);
    const { channelLayoutEnumDts, channelLayoutEnumJs } = channelLayoutEnumTemplate(listChannelLayouts());
    dtsLines.push('');
    dtsLines.push(channelLayoutEnumDts);
    jsLines.push(channelLayoutEnumJs);
    writeFileSync(dtsFile, dtsLines.join('\n'));
    writeFileSync(jsFile, jsLines.join('\n'));
}

generate();