"use strict";

// @IMPORTS
const Application = require("neat-base").Application;
const Module = require("neat-base").Module;
const Tools = require("neat-base").Tools;
const fs = require("fs");
const path = require("path");
const Promise = require("bluebird");

module.exports = class StructuredData extends Module {

    static defaultConfig() {
        return {
            dbModuleName: "database",
            configpath: "config/structured-data"
        }
    }

    /**
     *
     */
    init() {
        return new Promise((resolve, reject) => {
            this.log.debug("Initializing...");
            resolve(this);
        });
    }

    loadConfig(configName) {
        return require(path.resolve(path.join(Application.config.root_path, this.config.configpath, configName + ".js")));
    }

    getData(configName, doc) {
        return new Promise((resolve, reject) => {
            let config = null;

            try {
                config = this.loadConfig(configName);
            } catch (e) {
                return reject(e);
            }

            let populateProm = Promise.resolve();

            if (config.populate) {
                populateProm = doc.populate(config.populate).execPopulate()
            }

            return populateProm.then(() => {
                return this.getDataFromDocument(doc, config);
            }, reject).then(resolve, reject);
        });
    }

    getDataFromDocument(doc, config) {
        if (config.groups) {
            return Promise.map(config.groups, (group) => {
                this.log.debug("Processing group " + group.label);
                return this.getDataFromDocument(doc, group).then((data) => {
                    if ((!data || !data.length ) && !group.keepEmpty) {
                        this.log.debug("Dropping group " + group.label + " got empty data and !keepEmpty");
                        return;
                    }
                    return this.checkUseOfField(group, doc).then((val) => {
                        if (!val) {
                            this.log.debug("Not keeping group " + group.label + " condition failed");
                            return;
                        }

                        return {
                            type: "group",
                            label: group.label,
                            data: data
                        }
                    });
                });
            }).then((data) => {
                return data.filter(v => !!v);
            });
        } else if (config.fields) {
            return Promise.map(config.fields, (field) => {
                this.log.debug("Processing field " + field.label);
                if (field.groups) {
                    // field is a new array of groups
                    return this.getDataFromDocument(doc, field)
                } else if (field.fields) {
                    // field is a group itself
                    return this.getDataFromDocument(doc, field).then((subgroupFields) => {
                        if ((!subgroupFields || !subgroupFields.length ) && !field.keepEmpty) {
                            this.log.debug("Dropping subgroup " + field.label + " got empty data and !keepEmpty");
                            return;
                        }

                        return this.checkUseOfField(field, doc).then((val) => {
                            if (!val) {
                                this.log.debug("Not keeping subgroup " + field.label + " condition failed");
                                return;
                            }

                            return {
                                type: "group",
                                label: field.label,
                                data: subgroupFields
                            }
                        });
                    });
                }

                let valPromise = Promise.resolve(null);

                if (field.get) {
                    this.log.debug("Found get function on field " + field.label);
                    let getResult = field.get(doc);
                    if (getResult instanceof Promise) {
                        this.log.debug("Found Promise on field " + field.label);
                        valPromise = getResult;
                    } else {
                        this.log.debug("Found regular return on field " + field.label + " of type " + typeof getResult);
                        valPromise = Promise.resolve(getResult);
                    }
                } else if (field.path) {
                    this.log.debug("Found path on field " + field.label);
                    valPromise = Promise.resolve(doc.get(field.path));
                }

                return valPromise.then((realVal) => {
                    if ((realVal === null || realVal === undefined || realVal === "") && !field.keepEmpty) {
                        this.log.debug("Not keeping field " + field.label + " empty value and !keepEmpty");
                        return;
                    }

                    return this.checkUseOfField(field, doc).then((use) => {
                        if (!use) {
                            this.log.debug("Not keeping field " + field.label + " condition failed");
                            return;
                        }

                        let displayValue = realVal;

                        if (field.map) {
                            let tempVal = realVal;

                            if (typeof realVal !== "string") {
                                tempVal = String(realVal);
                            }

                            displayValue = field.map[tempVal] || realVal;
                        }

                        if (field.unit) {
                            if (typeof field.unit === "string") {
                                displayValue += field.unit;
                            } else if (field.unit instanceof Array) {
                                if (field.unit.length === 2) {
                                    if (realVal === 1) {
                                        displayValue += field.unit[0];
                                    } else {
                                        displayValue += field.unit[1];
                                    }
                                }
                            }
                        }

                        return {
                            type: "field",
                            label: field.label,
                            value: realVal,
                            display: displayValue,
                            path: field.path
                        }
                    });
                });
            }).then((data) => {
                return data.filter(v => !!v);
            });
        }
    }

    checkUseOfField(field, doc) {
        let usePromise = Promise.resolve(true);

        if (field.if) {
            usePromise = usePromise.then(() => {
                return Promise.map(Object.keys(field.if), (key) => {
                    let ifCondition = field.if[key];

                    if (typeof ifCondition !== "function") {
                        if (doc.get(key) == ifCondition) {
                            return true;
                        } else {
                            return false;
                        }
                    } else {
                        return ifCondition(doc);
                    }
                }).then((ifConditionresults) => {
                    return ifConditionresults.indexOf(false) === -1;
                });
            });
        }

        if (field.unless) {
            usePromise = usePromise.then(() => {
                return Promise.map(Object.keys(field.unless), (key) => {
                    let unlessCondition = field.unless[key];

                    if (typeof unlessCondition !== "function") {
                        if (doc.get(key) != unlessCondition) {
                            return true;
                        } else {
                            return false;
                        }
                    } else {
                        return unlessCondition(doc);
                    }
                }).then((unlessConditionresults) => {
                    return unlessConditionresults.indexOf(false) === -1;
                });
            });
        }

        return usePromise;
    }
}