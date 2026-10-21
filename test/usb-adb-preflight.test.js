import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedUsbAdb } from '../scripts/test-fixtures/usb-adb-preflight.mjs';

const serial = 'FICTIONAL123';
const adb = `List of devices attached\n${serial} device product:example model:Test transport_id:5\n`;
const composite = { Class: 'USB', InstanceId: `USB\\VID_1234&PID_ABCD\\${serial}` };
const interfaceDevice = { Class: 'AndroidUsbDeviceClass', InstanceId: 'USB\\VID_1234&PID_ABCD&ADB\\fixture', Parent: composite.InstanceId };

test('attended Wi-Fi preflight accepts a selected USB adb path without a usb: label', () => {
  assert.equal(selectedUsbAdb(adb, serial, [composite, interfaceDevice]), true);
  assert.equal(selectedUsbAdb(adb, serial, [composite, { ...interfaceDevice, InstanceId: 'USB\\VID_1234&PID_ABCD&MI_01\\fixture' }]), true);
  assert.equal(selectedUsbAdb(`List of devices attached\n${serial} device usb:1-2 transport_id:5\n`, serial), true);
});

test('attended Wi-Fi preflight refuses wireless, disconnected, or unrelated USB devices', () => {
  assert.equal(selectedUsbAdb(adb, serial), false);
  assert.equal(selectedUsbAdb(adb, serial, [composite]), false);
  assert.equal(selectedUsbAdb(adb, serial, [interfaceDevice]), false);
  assert.equal(selectedUsbAdb(adb, serial, [composite, { ...interfaceDevice, Parent: 'USB\\VID_1234&PID_ABCD\\OTHER' }]), false);
  assert.equal(selectedUsbAdb(adb, serial, [composite, { ...interfaceDevice, Parent: undefined }]), false);
  assert.equal(selectedUsbAdb(adb, serial, [composite, { ...interfaceDevice, InstanceId: 'ROOT\\VIRTUAL\\fixture' }]), false);
  assert.equal(selectedUsbAdb(adb.replace(' device ', ' offline '), serial, [composite, interfaceDevice]), false);
  assert.equal(selectedUsbAdb('List of devices attached\n192.168.1.5:5555 device\n', serial, [composite, interfaceDevice]), false);
});
