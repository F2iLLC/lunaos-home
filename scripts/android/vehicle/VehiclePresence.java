package io.github.f2illc.lunaos.home.vehicle;

import android.companion.CompanionDeviceService;

/** Android binds this service for the owner-approved companion association. */
public final class VehiclePresence extends CompanionDeviceService {
    @Override public void onDeviceAppeared(String address) { VehicleReceiver.start(this, address, false); }
    @Override public void onDeviceDisappeared(String address) { VehicleReceiver.disconnect(this, address); }
}
