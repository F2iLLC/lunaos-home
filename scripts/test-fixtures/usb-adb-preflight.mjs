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
      typeof device.InstanceId === 'string' && /^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}&ADB\\/i.test(device.InstanceId) &&
      typeof device.Parent === 'string' && compositeIds.has(device.Parent.toUpperCase());
  });
}
