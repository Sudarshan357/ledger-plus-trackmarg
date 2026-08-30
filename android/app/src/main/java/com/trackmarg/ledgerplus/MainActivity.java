package com.trackmarg.ledgerplus;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered BEFORE super.onCreate: that is where the bridge is built and the plugin
        // list is read. Registering after it silently does nothing, and the JS side then fails
        // with "UpdateInstaller does not have an implementation".
        registerPlugin(UpdateInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
