// The attended Wi-Fi test must retain an adb control path after Wi-Fi is off.
// Some Windows adb builds omit the usb: field even for a USB-connected phone.
export function selectedUsbAdb(adbList, serial, presentDevices = []) {
  if (typeof serial !== 'string' || !serial) return false;
  const selected = adbList.split(/\r?\n/).find(line => {
    const [target, state] = line.trim().split(/\s+/);
    return target === serial && state === 'device';
  });
  if (!selected) return false;
  if (/\busb:\S+/.test(selected)) return true;

  const compositeIds = new Set(presentDevices.flatMap(device => {
    if (device.Class !== 'USB' || typeof device.InstanceId !== 'string') return [];
    const match = /^USB\\(VID_[0-9A-F]{4}&PID_[0-9A-F]{4})\\([^\\]+)$/i.exec(device.InstanceId);
    return match && match[2].toUpperCase() === serial.toUpperCase() ? [device.InstanceId.toUpperCase()] : [];
  }));
  return presentDevices.some(device => {
    return /^Android/i.test(device.Class || '') &&
      typeof device.InstanceId === 'string' && device.InstanceId.toUpperCase().startsWith('USB\\') &&
      typeof device.Parent === 'string' && compositeIds.has(device.Parent.toUpperCase());
  });
}

// ADB and PnP are sampled separately; either still-present signal prevents detachment.
export function selectedUsbAdbDetached(snapshot, serial) {
  return !snapshot.adbList.split(/\r?\n/).some(line => line.trim().split(/\s+/)[0] === serial) &&
    !snapshot.presentDevices.some(device => /^Android/i.test(device.Class || '') &&
      typeof device.InstanceId === 'string' && device.InstanceId.toUpperCase().startsWith('USB\\'));
}

// Fallback when Windows assigns a topology ID instead of the phone serial to
// its USB composite. Require an attended detach/reattach of the exact adb
// serial and the sole Android USB interface; wireless adb stays present.
export function selectedUsbAdbByCableCycle(before, detached, reattached, serial) {
  const active = snapshot => snapshot.adbList.split(/\r?\n/).flatMap(line => {
    const [id, state] = line.trim().split(/\s+/);
    return state === 'device' ? [id] : [];
  });
  const physicalInterfaces = snapshot => {
    const composites = new Set(snapshot.presentDevices.flatMap(device =>
      device.Class === 'USB' && typeof device.InstanceId === 'string'
        ? [device.InstanceId.toUpperCase()] : []));
    return snapshot.presentDevices.filter(device => /^Android/i.test(device.Class || '') &&
      typeof device.InstanceId === 'string' && device.InstanceId.toUpperCase().startsWith('USB\\') &&
      typeof device.Parent === 'string' && composites.has(device.Parent.toUpperCase()));
  };
  return active(before).length === 1 && active(before)[0] === serial &&
    selectedUsbAdbDetached(detached, serial) &&
    active(reattached).length === 1 && active(reattached)[0] === serial &&
    physicalInterfaces(before).length === 1 && physicalInterfaces(detached).length === 0 &&
    physicalInterfaces(reattached).length === 1;
}
