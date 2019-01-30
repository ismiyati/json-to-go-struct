import {analyseType, getSortedKey} from "./objectHelper";

function upperFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}


function parseJson(json) {

    try {
        return {value: JSON.parse(json), err: false}
    } catch (e) {
        return {value: e.message, err: true}
    }
}

function makeStructMap(obj, structName, goFloat64 = true) {

    let layers = {};
    let goStructCandidate = {}; // {  name: [ signature1, signature2, ..... signatureN ] }
    let omitemptyMember = {};

    function makeParseKey(prefixKey, key) {
        return `(${prefixKey},${key})`;
    }

    function addToGoStructCandidate(key, arrayOfStringValue) {
        if (goStructCandidate.hasOwnProperty(key)) {
            goStructCandidate[key].push(arrayOfStringValue);
        } else {
            goStructCandidate[key] = [arrayOfStringValue];
        }
    }

    function parseMap(jsonObj, layer, prefixKey) {
        if (jsonObj == null) {
            return;
        }


        for (const key of getSortedKey(jsonObj)) {
            const value = jsonObj[key];
            const type = analyseType(value);
            const parsedKey = makeParseKey(prefixKey, key);

            if (layers.hasOwnProperty(layer)) {
                layers[layer].push([parsedKey, type])
            } else {
                layers[layer] = [[parsedKey, type]]
            }

            if (type == "object") {
                parseMap(value, layer + 1, parsedKey);
                addToGoStructCandidate(key, Object.keys(value))
            } else if (type.includes("array")) {
                value.forEach(v => {
                    if (analyseType(v) == "object") {
                        parseMap(v, layer + 1, parsedKey);
                        addToGoStructCandidate(key, Object.keys(v));
                    }
                });
            }

        }
    }

    let wrapper = {};
    wrapper[structName] = obj;
    parseMap(wrapper, 0, "");

    (function combinedGoStructCandidateMember() {
        Object.keys(goStructCandidate).forEach(key =>{
            let typeMap = {};
            let memberCount = {};
            let flattenCandidateMember = flattenDeep(goStructCandidate[key]);
            flattenCandidateMember.forEach(x => {
               if(memberCount[x]){
                   memberCount[x] = memberCount[x] + 1;
               } else{
                   memberCount[x] = 1;
               }
            });
            Object.keys(memberCount).map(k => { memberCount[k] = memberCount[k] < goStructCandidate[key].length  });
            omitemptyMember[key] = memberCount;
            (new Set(flattenCandidateMember)).forEach(x => {typeMap[x] = [] });
            goStructCandidate[key] =  typeMap ;
        })
    })();

    (function fillingTypeToGoStructCandidateMember() {

        const keyList = getSortedKey(layers);
        const keys = keyList.reverse().slice(0,keyList.length - 1);
        for( const key of keys ){
            layers[key].forEach(x => {
                let keyStr = x[0];
                let keyStrArray =  keyStr.split(/[,\)]/g).filter(x => x != "");
                let goStructName = keyStrArray[keyStrArray.length - 2 ];
                let memberName= keyStrArray[keyStrArray.length - 1 ];
                let type = x[1];
                if(!goStructCandidate[goStructName][memberName].includes(type)){
                    goStructCandidate[goStructName][memberName].push(type);
                }

            });
        }
    })();

    let rootType = layers["0"][0][1];
    return {goStructCandidate,omitemptyMember,rootType};
}

function flattenDeep(arr) {
    return arr.reduce((acc, val) => Array.isArray(val) ? acc.concat(flattenDeep(val)) : acc.concat(val), []);
}

function makeGoType(arrayTypes,key,isReferenceType) {
    const userDefinedType = makeGoStructVariable(key);
    if(arrayTypes.length == 1){
        switch (arrayTypes[0]) {
            case "array_object": return `[]${userDefinedType}`;
            case "object": return isReferenceType? "*" + userDefinedType : userDefinedType;
            case "boolean": return `bool`;
            case "array_int": return `[]int`;
            case "array_string": return `[]string`;
            case "array_float32": return `[]float32`;
            case "array_float64": return `[]float64`;
            case "array_empty": return `[]interface{}`;
            case "null": return `interface{}`;
        }
        return arrayTypes[0];
    }
    if(arrayTypes.includes("array_object")){
        return `[]${userDefinedType}`;
    }

    return "interface{}"
}

/**
 * --> 'a,b'
 * <-- 'A'
 *
 * --> 'abc,def'
 * <-- 'Abc'
 *
 * @param key2
 */
function makeGoStructVariable__Deprecate(key) {

    let s = key.split(',');

    return upperFirstLetter(s[0])

}

function makeGoStructVariable(s) {
    return s.split("_").map(x => upperFirstLetter(x)).join("");

}

/**
 * @param structMap e.g { Abc: { name: 'string' , surname: 'string' } }
 * @returns {undefined}
 */
function constructGoType(candidates,omitemptyMember,rootType,rootStructName) {

    let result = '';
    Object.keys(candidates).forEach(key =>{
        // parent layer

        let goStruct = (key == rootStructName && rootType.includes("array_") )? `type ${makeGoStructVariable(key)} []struct {`: `type ${makeGoStructVariable(key)} struct {`;
        // let goStruct = `type ${makeGoStructVariable(key)} struct {`;
        const values = Object.keys(candidates[key]);

        for (const key2 of values) {
            // key2 = member name
            const arrayTypes = candidates[key][key2];
            const isReferenceType = key == key2;
            const goType = makeGoType(arrayTypes,key2,isReferenceType);
            const jsonType =  (!goType.includes("interface")) && omitemptyMember[key][key2] ? `\t\`json:"${key2},omitempty"\`` : `\t\`json:"${key2}"\``;
            const templatedKeyValue = makeGoStructVariable(key2) + "\t" + makeGoType(arrayTypes,key2,isReferenceType) + jsonType;
            goStruct += "\n" + templatedKeyValue
        }
        goStruct += `\n}\n\n`;
        result += goStruct
    });
    return result;
}

function jsonToGoStruct(json, structName, goFloat64 = true) {

    // json.Parse( '{ a : 1.0}' ) will results { a : 1 }
    // In order to keep float as float ( value doesn't matter but type )
    // we will replace all .0 to be .1
    json = json.replace(/\.0/g, '.1');

    // Validate if input string is a valid Jason format.
    const {value, err} = parseJson(json);
    if (err) {
        return {value, err}
    }

    const rootStructName = makeGoStructVariable(structName);

    // check empty object
    if (Object.keys(value).length == 0) {
        return {value: `type ${rootStructName} struct {}`, err: false}
    }


    console.debug(value);
    const {goStructCandidate,omitemptyMember,rootType} = makeStructMap(value, rootStructName, goFloat64);
    console.debug(goStructCandidate);
    const goStruct = constructGoType(goStructCandidate,omitemptyMember,rootType,rootStructName);

    return {
        // value: `type ${rootStructName} struct {
        //
        // }`,
        value: goStruct,
        err: false
    };
}

export default jsonToGoStruct