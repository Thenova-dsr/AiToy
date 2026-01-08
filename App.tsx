import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  PermissionsAndroid,
  Platform,
  StatusBar,
  useColorScheme,
  Modal,
  Linking,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { BleManager, Device } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';

const bleManager = new BleManager();

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const AUTH_CHAR_UUID = 'beefdead-36e1-4688-b7f5-ea48cd562222';
const DATA_CHAR_UUID = 'beefcafe-36e1-4688-b7f5-00000000000b';
const STATUS_CHAR_UUID = 'beefc0de-36e1-4688-b7f5-ea48cd563333';

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent(): React.JSX.Element {
  const safeAreaInsets = useSafeAreaInsets();
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [receivedMessages, setReceivedMessages] = useState<string[]>([]);
  const [statusText, setStatusText] = useState<string>('Scan QR Code to connect');
  
  const [showPasswordModal, setShowPasswordModal] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [showScanner, setShowScanner] = useState<boolean>(false);
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  
  const deviceRef = useRef<Device | null>(null);
  const device = useCameraDevice('back');

  useEffect(() => {
    requestPermissions();
    
    return () => {
      bleManager.destroy();
    };
  }, []);

  const requestPermissions = async (): Promise<void> => {
    if (Platform.OS === 'android') {
      try {
        const apiLevel = Platform.Version;
        
        const permissions = [
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ];
        
        if (apiLevel >= 31) {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
          );
        } else {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADMIN
          );
        }
        
        const granted = await PermissionsAndroid.requestMultiple(permissions);
        
        const allGranted = Object.values(granted).every(
          status => status === PermissionsAndroid.RESULTS.GRANTED
        );
        
        if (allGranted) {
          setHasPermission(true);
        } else {
          Alert.alert('Permissions Required', 'Camera and Bluetooth permissions are needed');
        }
      } catch (err) {
        console.warn(err);
      }
    } else {
      // iOS
      const cameraPermission = await Camera.requestCameraPermission();
      setHasPermission(cameraPermission === 'granted');
    }
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (codes.length > 0 && codes[0].value) {
        const qrData = codes[0].value;
        console.log('📷 QR Code scanned:', qrData);
        
        // Expected format: "ESP32_Health:MAC_ADDRESS"
        // Or just device name: "ESP32_Health"
        const deviceName = qrData.split(':')[0];
        
        setShowScanner(false);
        connectToDeviceByName(deviceName);
      }
    },
  });

  const connectToDeviceByName = (deviceName: string): void => {
    setStatusText(`Looking for ${deviceName}...`);
    console.log('🔍 Scanning for:', deviceName);
    
    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error('Scan error:', error);
        setStatusText('Scan error');
        return;
      }
      
      if (device && device.name === deviceName) {
        console.log('✅ Found device!');
        bleManager.stopDeviceScan();
        connectToDevice(device);
      }
    });
    
    // Stop scanning after 10 seconds
    setTimeout(() => {
      bleManager.stopDeviceScan();
      if (!connectedDevice) {
        setStatusText('Device not found. Try again.');
      }
    }, 10000);
  };

  const connectToDevice = async (device: Device): Promise<void> => {
    try {
      setStatusText('Connecting...');
      
      const connectedDevice = await device.connect();
      deviceRef.current = connectedDevice;
      setConnectedDevice(connectedDevice);
      
      await connectedDevice.discoverAllServicesAndCharacteristics();
      
      // Monitor Status
      connectedDevice.monitorCharacteristicForService(
        SERVICE_UUID,
        STATUS_CHAR_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('Status error:', error);
            return;
          }
          
          if (characteristic?.value) {
            const status = Buffer.from(characteristic.value, 'base64').toString('utf-8');
            console.log('📩 Status:', status);
            handleStatusUpdate(status);
          }
        }
      );
      
      // Monitor Data
      connectedDevice.monitorCharacteristicForService(
        SERVICE_UUID,
        DATA_CHAR_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('Data error:', error);
            return;
          }
          
          if (characteristic?.value) {
            const data = Buffer.from(characteristic.value, 'base64').toString('utf-8');
            console.log('📨 Received:', data);
            setReceivedMessages(prev => [...prev, data]);
          }
        }
      );
      
      setStatusText('Connected! Waiting for auth...');
      
    } catch (error: any) {
      console.error('Connection error:', error);
      setStatusText('Connection failed');
      Alert.alert('Error', error.message);
    }
  };

  const handleStatusUpdate = (status: string): void => {
    if (status === 'AUTH_REQUIRED') {
      setShowPasswordModal(true);
    } else if (status === 'AUTH_SUCCESS') {
      setIsAuthenticated(true);
      setShowPasswordModal(false);
      setStatusText('✓ Authenticated');
      Alert.alert('Success', 'Connected securely!');
    } else if (status.startsWith('AUTH_FAILED:')) {
      const attemptsLeft = status.split(':')[1] || '0';
      Alert.alert('Wrong Password', `${attemptsLeft} attempts left`);
      setPasswordInput('');
    } else if (status === 'AUTH_FAILED_MAX') {
      Alert.alert('Failed', 'Max attempts reached');
      setShowPasswordModal(false);
      disconnect();
    }
  };

  const submitPassword = async (): Promise<void> => {
    if (!passwordInput.trim()) {
      Alert.alert('Error', 'Enter password');
      return;
    }

    try {
      if (connectedDevice) {
        const passwordBytes = Buffer.from(passwordInput, 'utf-8').toString('base64');
        
        await connectedDevice.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          AUTH_CHAR_UUID,
          passwordBytes
        );
        
        setStatusText('Authenticating...');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const sendMessage = async (): Promise<void> => {
    if (!isAuthenticated) {
      Alert.alert('Not Authenticated', 'Authenticate first');
      return;
    }

    if (!message.trim()) {
      Alert.alert('Empty', 'Enter a message');
      return;
    }

    try {
      if (connectedDevice) {
        const messageBytes = Buffer.from(message, 'utf-8').toString('base64');
        
        await connectedDevice.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          DATA_CHAR_UUID,
          messageBytes
        );
        
        setMessage('');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const disconnect = async (): Promise<void> => {
    try {
      if (connectedDevice) {
        await connectedDevice.cancelConnection();
        setConnectedDevice(null);
        setIsAuthenticated(false);
        setStatusText('Disconnected');
        setReceivedMessages([]);
        setShowPasswordModal(false);
        setPasswordInput('');
      }
    } catch (error: any) {
      console.error('Disconnect error:', error);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
      <Text style={styles.title}>ESP32 Healthcare</Text>
      
      <Text style={styles.status}>{statusText}</Text>

      {/* Password Modal */}
      <Modal visible={showPasswordModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>🔒 Enter Password</Text>
            
            <TextInput
              style={styles.passwordInput}
              placeholder="Password (HEALTH2024)"
              placeholderTextColor="#999"
              value={passwordInput}
              onChangeText={setPasswordInput}
              secureTextEntry
              autoFocus
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelButton]} 
                onPress={() => {
                  setShowPasswordModal(false);
                  disconnect();
                }}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, styles.connectButton]} 
                onPress={submitPassword}>
                <Text style={styles.modalButtonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* QR Scanner Modal */}
      <Modal visible={showScanner} animationType="slide">
        <View style={styles.scannerContainer}>
          {device && hasPermission && (
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={showScanner}
              codeScanner={codeScanner}
            />
          )}
          
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerText}>Scan QR Code</Text>
            <TouchableOpacity 
              style={styles.closeScannerButton}
              onPress={() => setShowScanner(false)}>
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {!connectedDevice ? (
        <>
          <TouchableOpacity 
            style={styles.qrButton} 
            onPress={() => setShowScanner(true)}>
            <Text style={styles.qrButtonText}>📷 Scan QR Code</Text>
          </TouchableOpacity>
          
          <Text style={styles.orText}>OR</Text>
          
          <TouchableOpacity 
            style={styles.manualButton}
            onPress={() => connectToDeviceByName('ESP32_Health')}>
            <Text style={styles.buttonText}>Connect Manually</Text>
          </TouchableOpacity>
        </>
      ) : !isAuthenticated ? (
        <>
          <Text style={styles.waitingText}>⏳ Waiting for authentication...</Text>
          
          <TouchableOpacity 
            style={styles.manualAuthButton} 
            onPress={() => setShowPasswordModal(true)}>
            <Text style={styles.buttonText}>Enter Password</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.disconnectButton} onPress={disconnect}>
            <Text style={styles.buttonText}>Disconnect</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.messageSection}>
            <Text style={styles.subtitle}>Send Message:</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Type message"
                value={message}
                onChangeText={setMessage}
              />
              <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
                <Text style={styles.buttonText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.subtitle}>Received:</Text>
          <ScrollView style={styles.messagesContainer}>
            {receivedMessages.length === 0 ? (
              <Text style={styles.emptyText}>No messages yet</Text>
            ) : (
              receivedMessages.map((msg, index) => (
                <Text key={index} style={styles.receivedMessage}>
                  {msg}
                </Text>
              ))
            )}
          </ScrollView>

          <TouchableOpacity style={styles.disconnectButton} onPress={disconnect}>
            <Text style={styles.buttonText}>Disconnect</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 20,
    color: '#333',
  },
  status: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    paddingVertical: 12,
    paddingHorizontal: 15,
    backgroundColor: '#fff',
    borderRadius: 8,
    textAlign: 'center',
  },
  qrButton: {
    backgroundColor: '#4CAF50',
    padding: 20,
    borderRadius: 12,
    marginBottom: 15,
    alignItems: 'center',
  },
  qrButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  orText: {
    textAlign: 'center',
    color: '#999',
    marginVertical: 10,
    fontSize: 16,
  },
  manualButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  messageSection: {
    marginBottom: 15,
  },
  inputContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
  },
  sendButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: 'center',
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
  },
  receivedMessage: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
  disconnectButton: {
    backgroundColor: '#f44336',
    padding: 15,
    borderRadius: 8,
  },
  waitingText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginVertical: 20,
    fontWeight: '600',
  },
  manualAuthButton: {
    backgroundColor: '#FF9800',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '85%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#f9f9f9',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f44336',
  },
  connectButton: {
    backgroundColor: '#4CAF50',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  scannerOverlay: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scannerText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  closeScannerButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
});

export default App;