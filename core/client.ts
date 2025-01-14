import readlineSync from 'readline-sync';
import {DaelimConfig} from "./interfaces/daelim-config";
import {Utils} from "./utils";
import {Logging} from "homebridge";
import {ErrorCallback, NetworkHandler, ResponseCallback} from "./network";
import {DeviceSubTypes, Errors, LoginSubTypes, SubTypes, Types} from "./fields";
import {Complex} from "./interfaces/complex";

interface ClientAuthorization {
    certification: string,
    login: string
}

interface ClientAddress {
    complex: string,
    room: string
}

export class Client {

    public static MMF_SERVER_PORT = 25301;

    private readonly log: Logging
    private readonly config: DaelimConfig;
    private readonly authorization: ClientAuthorization;
    private readonly address: ClientAddress;
    private complex?: Complex;
    private handler?: NetworkHandler;
    private isLoggedIn = false;
    private lastKeepAliveTimestamp: number;

    constructor(log: Logging, config: DaelimConfig) {
        this.log = log;
        this.config = config;
        this.authorization = {
            certification: '00000000',
            login: ''
        };
        this.address = {
            complex: '',
            room: ''
        };
        this.lastKeepAliveTimestamp = Date.now();
    }

    checkKeepAlive() {
        const currentTime = Date.now();
        if(currentTime - this.lastKeepAliveTimestamp < 10 * 60 * 1000) {
            // Check keep alive when last keep alive time has passed for 10 minutes
            return;
        }
        this.lastKeepAliveTimestamp = currentTime;
        this.sendUnreliableRequest({}, Types.DEVICE, DeviceSubTypes.QUERY_REQUEST);
        this.log('Attempted to check the socket connection is alive');
    }

    private getAuthorizationPIN(): string {
        let pin: string;
        if(this.authorization.login.length !== 8) {
            pin = this.authorization.certification;
        } else {
            pin = this.authorization.login;
        }
        return pin;
    }

    sendUnreliableRequest(body: any, type: Types, subType: SubTypes) {
        if(this.handler !== undefined) {
            this.handler.sendUnreliableRequest(body, this.getAuthorizationPIN(), type, subType);
        }
    }

    sendDeferredRequest(body: any, type: Types, fromSubType: SubTypes, toSubType: SubTypes, matches?: (response: any) => boolean): Promise<any> {
        if(this.handler !== undefined) {
            return this.handler.sendDeferredRequest(body, this.getAuthorizationPIN(), type, fromSubType, toSubType, matches);
        }
        return new Promise<any>((resolve, reject) => reject('Handler not valid'));
    }

    registerResponseListener(type: Types, subType: SubTypes, callback: ResponseCallback) {
        if(this.handler !== undefined) {
            this.handler.registerResponseListener(type, subType, callback);
        }
    }

    registerErrorListener(error: Errors, callback: ErrorCallback) {
        if(this.handler !== undefined) {
            this.handler.registerErrorListener(error, callback);
        }
    }

    registerListeners() {
        this.registerResponseListener(Types.LOGIN, LoginSubTypes.CERTIFICATION_PIN_RESPONSE, (body) => {
            this.authorization.certification = body['certpin'];
            this.address.complex = body['dong'];
            this.address.room = body['ho'];

            this.sendUnreliableRequest({
                id: this.config.username,
                pw: this.config.password,
                certpin: this.authorization.certification
            }, Types.LOGIN, LoginSubTypes.LOGIN_PIN_REQUEST);
        });
        this.registerResponseListener(Types.LOGIN, LoginSubTypes.LOGIN_PIN_RESPONSE, (body) => {
            this.authorization.login = body['loginpin'];
            this.sendUnreliableRequest({}, Types.LOGIN, LoginSubTypes.MENU_REQUEST);
        });
        this.registerResponseListener(Types.LOGIN, LoginSubTypes.MENU_RESPONSE, (_) => {
            this.isLoggedIn = true;
            if(this.handler?.flushAllEnqueuedBuffers(this.getAuthorizationPIN())) {
                this.log("Flushed entire enqueued request buffers");
            }
        });
        this.registerResponseListener(Types.LOGIN, LoginSubTypes.WALL_PAD_RESPONSE, (_) => {
            this.log('Certified Wall pad PIN');
            this.sendCertificationRequest();
        });
    }

    registerErrorListeners() {
        this.registerErrorListener(Errors.UNCERTIFIED_DEVICE, () => {
            this.sendUnreliableRequest({
                id: this.config.username,
                pw: this.config.password,
            }, Types.LOGIN, LoginSubTypes.DELETE_CERTIFICATION_REQUEST);
            this.sendUnreliableRequest({
                id: this.config.username
            }, Types.LOGIN, LoginSubTypes.APPROVAL_DELETE_REQUEST);
            this.handleWallPadInput();
        });
        this.registerErrorListener(Errors.INVALID_CERTIFICATION_NUMBER, () => {
            this.handleWallPadInput();
        });
        this.registerErrorListener(Errors.INVALID_USERNAME_AND_PASSWORD, () => {
            this.log.error("Username or password is not valid.");
        });
        this.registerErrorListener(Errors.REGISTRATION_NOT_COMPLETED, () => {
            this.handleWallPadInput();
        });
    }

    requestForWallPad() {
        this.sendUnreliableRequest({
            dong: this.address.complex,
            ho: this.address.room,
            id: this.config.username,
            auth: 2
        }, Types.LOGIN, LoginSubTypes.APPROVAL_REQUEST);
    }

    handleWallPadInput() {
        this.requestForWallPad();

        let wallPadNumber;
        try {
            wallPadNumber = readlineSync.question('Enter wall-pad PIN: ');
        } catch(e) {
            this.log.error("##");
            this.log.error("## Reading wall-pad number in terminal is not available.");
            this.log.error("## Run homebridge in inline mode.");
            this.log.error("##");
            return;
        }

        this.sendUnreliableRequest({
            dong: this.address.complex,
            ho: this.address.room,
            id: this.config.username,
            num: String(wallPadNumber)
        }, Types.LOGIN, LoginSubTypes.WALL_PAD_REQUEST);
    }

    sendCertificationRequest() {
        this.sendUnreliableRequest({
            id: this.config.username,
            pw: this.config.password,
            UUID: this.config.uuid
        }, Types.LOGIN, LoginSubTypes.CERTIFICATION_PIN_REQUEST);
    }

    async prepareService() {
        this.log('Looking for complex info...');
        this.complex = await Utils.findMatchedComplex(this.config.region, this.config.complex);
        this.log(`Complex info about (${this.config.complex}) has found.`);
        this.handler = new NetworkHandler(this.log, this.complex);
        this.handler.onConnected = () => {
            this.sendCertificationRequest();
        };
        this.handler.onDisconnected = () => {
            this.isLoggedIn = false;
            this.log("Connection broken. Reconnect to the server...");
            this.handler?.handle();
        };
    }

    startService() {
        if(this.handler === undefined) {
            return;
        }
        this.registerListeners();
        this.registerErrorListeners();

        this.handler.handle();
    }

}