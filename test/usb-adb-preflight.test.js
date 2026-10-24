import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedUsbAdb, selectedUsbAdbByCableCycle, selectedUsbAdbDetached } from '../scripts/test-fixtures/usb-adb-preflight.mjs';

const serial = 'FICTIONAL123';
const adb = `List of devices attached\n${serial} device product:example model:Test transport_id:5\n`;
const composite = { Class: 'USB', InstanceId: `USB\\VID_1234&PID_ABCD\\${serial}` };
const interfaceDevice = { Class: 'AndroidUsbDeviceClass', InstanceId: 'USB\\VID_1234&PID_ABCD&ADB\\fixture', Parent: composite.InstanceId };

test('detach sampling rejects a still-listed serial regardless of whitespace or adb state', () => {
  for (const separator of [' ', '\t', '  \t']) {
    for (const state of ['device', 'offline', 'unauthorized']) {
      const mixed = { adbList: `List of devices attached\n${serial}${separator}${state}\n`, presentDevices: [] };
      assert.equal(selectedUsbAdbDetached(mixed, serial), false);
    }
  }
  assert.equal(selectedUsbAdbDetached({ adbList: 'List of devices attached\n', presentDevices: [interfaceDevice] }, serial), false);
  assert.equal(selectedUsbAdbDetached({ adbList: 'List of devices attached\n', presentDevices: [] }, serial), true);
});

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

test('attended cable cycle binds a topology-only USB interface to the selected adb serial', () => {
  const topology = { Class: 'USB', InstanceId: 'USB\\VID_1234&PID_ABCD\\TOPOLOGY' };
  const interfaceDevice = { Class: 'AndroidUsbDeviceClass', InstanceId: 'USB\\VID_1234&PID_ABCD&ADB\\IFACE', Parent: topology.InstanceId };
  const before = { adbList: adb, presentDevices: [topology, interfaceDevice] };
  const detached = { adbList: 'List of devices attached\n', presentDevices: [] };
  const reattached = { adbList: adb, presentDevices: [topology, interfaceDevice] };
  assert.equal(selectedUsbAdb(adb, serial, before.presentDevices), false);
  assert.equal(selectedUsbAdbByCableCycle(before, detached, reattached, serial), true);
  assert.equal(selectedUsbAdbByCableCycle(before, { ...detached, adbList: adb }, reattached, serial), false);
  assert.equal(selectedUsbAdbByCableCycle(before, { ...detached, presentDevices: [topology, interfaceDevice] }, reattached, serial), false);
  assert.equal(selectedUsbAdbByCableCycle(before, detached,
    { ...reattached, adbList: 'List of devices attached\n192.168.1.5:5555 device\n' }, serial), false);
  assert.equal(selectedUsbAdbByCableCycle(before, detached,
    { ...reattached, presentDevices: [] }, serial), false);
});
