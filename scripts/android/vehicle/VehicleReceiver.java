package io.github.f2illc.lunaos.home.vehicle;

import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothProfile;
import android.content.*;

/** Only protected OS Bluetooth broadcasts. Never accepts a caller's vehicle name. */
public final class VehicleReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        boolean media = BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED.equals(action);
        if (!media && !BluetoothDevice.ACTION_ACL_CONNECTED.equals(action) && !BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) return;
        BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        if (device == null) return;
        try {
            if (device.getBondState() != BluetoothDevice.BOND_BONDED) return;
            if (media) {
                int state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1);
                if (state == BluetoothProfile.STATE_CONNECTED) start(context, device.getAddress(), false);
                else if (state == BluetoothProfile.STATE_DISCONNECTED) disconnect(context, device.getAddress());
                return;
            }
            if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) start(context, device.getAddress(), false);
            else disconnect(context, device.getAddress());
        } catch (SecurityException revoked) { }
    }
    static void start(Context context, String address, boolean tapped) {
        VehicleState state = new VehicleState(context);
        if (address.isEmpty() || !address.equalsIgnoreCase(state.address) || !associated(context, address)) return;
        try {
            context.startForegroundService(new Intent(context, VehicleAudioService.class).putExtra("address", address));
        } catch (RuntimeException restricted) {
            state.status = "Android requires a tap. Park, then tap the greeting notification."; state.save();
            VehicleAudioService.notifyTap(context);
        }
    }
    static boolean associated(Context context, String address) {
        try { return context.getSystemService(android.companion.CompanionDeviceManager.class).getAssociations().contains(address); }
        catch (RuntimeException unavailable) { return false; }
    }
    static void disconnect(Context context, String address) {
        VehicleState state = new VehicleState(context);
        if (address.isEmpty() || !address.equalsIgnoreCase(state.address)) return;
        context.stopService(new Intent(context, VehicleAudioService.class));
        VehicleRuntime.disconnect(context);
    }
}
