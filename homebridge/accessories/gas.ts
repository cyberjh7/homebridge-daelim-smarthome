import {Accessories, AccessoryInterface} from "./accessories";
import {
    API,
    CharacteristicEventTypes,
    CharacteristicGetCallback,
    CharacteristicSetCallback,
    CharacteristicValue,
    Logging,
    PlatformAccessory,
    Service
} from "homebridge";
import {DeviceSubTypes, LoginSubTypes, Types} from "../../core/fields";
import {DaelimConfig} from "../../core/interfaces/daelim-config";

interface GasAccessoryInterface extends AccessoryInterface {

    on: boolean

}

export class GasAccessories extends Accessories<GasAccessoryInterface> {

    constructor(log: Logging, api: API, config: DaelimConfig | undefined) {
        super(log, api, config, ["gas"], [api.hap.Service.Valve]);
    }

    async identify(accessory: PlatformAccessory): Promise<void> {
        await super.identify(accessory);

        if(!!accessory.context.on) {
            const response = await this.client?.sendDeferredRequest({
                type: 'invoke',
                item: [{
                    device: 'gas',
                    uid: accessory.context.deviceID,
                    arg1: "off"
                }]
            }, Types.DEVICE, DeviceSubTypes.INVOKE_REQUEST, DeviceSubTypes.INVOKE_RESPONSE, body => {
                return this.matchesAccessoryDeviceID(accessory, body);
            }).catch(_ => {
                return undefined;
            });
            if(response === undefined) {
                this.log.warn("The accessory %s does not respond", accessory.displayName);
            }
        } else {
            this.log.warn("The accessory %s is currently off, identification is impossible", accessory.displayName);
        }
    }

    configureAccessory(accessory: PlatformAccessory, services: Service[]) {
        super.configureAccessory(accessory, services);
        const service = this.ensureServiceAvailability(this.api.hap.Service.Valve, services);

        service.getCharacteristic(this.api.hap.Characteristic.Active)
            .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                const isActive = value === this.api.hap.Characteristic.Active.ACTIVE
                // Old state is same with new state
                if(accessory.context.on === isActive) {
                    callback(undefined);
                    return;
                }
                if(!accessory.context.on) {
                    if(isActive) {
                        this.client?.sendUnreliableRequest({
                            type: 'query',
                            item: [{
                                device: 'gas',
                                uid: 'All'
                            }]
                        }, Types.DEVICE, DeviceSubTypes.QUERY_REQUEST);
                    }
                    callback(undefined);
                    return;
                }
                const response = await this.client?.sendDeferredRequest({
                    type: 'invoke',
                    item: [{
                        device: 'gas',
                        uid: accessory.context.deviceID,
                        arg1: 'off'
                    }]
                }, Types.DEVICE, DeviceSubTypes.INVOKE_REQUEST, DeviceSubTypes.INVOKE_RESPONSE, body => {
                    return this.matchesAccessoryDeviceID(accessory, body);
                }).catch(_ => {
                    return undefined;
                })
                if(response == undefined) {
                    callback(new Error('TIMED OUT'));
                    return;
                }
                this.refreshGasValveState(response['item'] || []);
                callback(undefined);
            })
            .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
                if(!this.checkAccessoryAvailability(accessory, callback)) {
                    return;
                }
                callback(undefined, accessory.context.on ? this.api.hap.Characteristic.Active.ACTIVE : this.api.hap.Characteristic.Active.INACTIVE);
            });

        service.getCharacteristic(this.api.hap.Characteristic.InUse)
            .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
                if(!this.checkAccessoryAvailability(accessory, callback)) {
                    return;
                }
                callback(undefined, accessory.context.on ? this.api.hap.Characteristic.InUse.IN_USE : this.api.hap.Characteristic.InUse.NOT_IN_USE);
            });

        service.getCharacteristic(this.api.hap.Characteristic.ValveType)
            .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
                if(!this.checkAccessoryAvailability(accessory, callback)) {
                    return;
                }
                callback(undefined, this.api.hap.Characteristic.ValveType.GENERIC_VALVE);
            });
    }

    matchesAccessoryDeviceID(accessory: PlatformAccessory, body: any): boolean {
        const items = body['item'] || [];
        for(let i = 0; i < items.length; i++) {
            const item = items[i];
            const deviceID = item['uid'];
            if(accessory.context.deviceID === deviceID) {
                return true;
            }
        }
        return false;
    }

    refreshGasValveState(items: any[], force: boolean = false) {
        for(let i = 0; i < items.length; i++) {
            const item = items[i];
            const deviceID = item['uid'];
            const accessory = this.findAccessoryWithDeviceID(deviceID);
            if(accessory) {
                if(!this.checkForciblyRefreshable(accessory.context as GasAccessoryInterface, force)) {
                    continue;
                }
                accessory.context.on = item['arg1'] === 'on';
                accessory.context.init = true;
                if(force) {
                    this.findService(accessory, this.api.hap.Service.Valve, (service) => {
                        service.setCharacteristic(this.api.hap.Characteristic.Active, accessory.context.on ? this.api.hap.Characteristic.Active.ACTIVE : this.api.hap.Characteristic.Active.INACTIVE);
                        service.setCharacteristic(this.api.hap.Characteristic.InUse, accessory.context.on ? this.api.hap.Characteristic.InUse.IN_USE : this.api.hap.Characteristic.InUse.NOT_IN_USE);
                        service.setCharacteristic(this.api.hap.Characteristic.ValveType, this.api.hap.Characteristic.ValveType.GENERIC_VALVE);
                    });
                }
            }
        }
    }

    registerListeners() {
        this.client?.registerResponseListener(Types.LOGIN, LoginSubTypes.MENU_RESPONSE, (body) => {
            const controls = body['controlinfo'];
            const gases = controls['gas'];
            if(gases) {
                for(let i = 0; i < gases.length; i++) {
                    const gas = gases[i];

                    const deviceID = gas['uid'];
                    const displayName = gas['uname'];

                    this.addAccessory({
                        deviceID: deviceID,
                        displayName: displayName,
                        init: false,
                        on: true // active as a default since this is off-only valve
                    });
                }
                this.client?.sendUnreliableRequest({
                    type: 'query',
                    item: [{
                        device: 'gas',
                        uid: 'All'
                    }]
                }, Types.DEVICE, DeviceSubTypes.QUERY_REQUEST);
            }
        })
        this.client?.registerResponseListener(Types.DEVICE, DeviceSubTypes.QUERY_RESPONSE, (body) => {
            this.refreshGasValveState(body['item'] || [], true);
        });
        this.client?.registerResponseListener(Types.DEVICE, DeviceSubTypes.INVOKE_RESPONSE, (body) => {
            this.refreshGasValveState(body['item'] || [], true);
        });
    }

}