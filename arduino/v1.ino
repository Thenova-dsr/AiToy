#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// UUIDs for BLE Service and Characteristics
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define AUTH_CHAR_UUID      "beefdead-36e1-4688-b7f5-ea48cd562222"  // Password characteristic
#define DATA_CHAR_UUID      "beefcafe-36e1-4688-b7f5-00000000000b"  // Data characteristic
#define STATUS_CHAR_UUID    "beefc0de-36e1-4688-b7f5-ea48cd563333"  // Status characteristic

BLEServer* pServer = NULL;
BLECharacteristic* pAuthCharacteristic = NULL;
BLECharacteristic* pDataCharacteristic = NULL;
BLECharacteristic* pStatusCharacteristic = NULL;

bool deviceConnected = false;
bool isAuthenticated = false;
String devicePassword = "HEALTH2024";
int authAttempts = 0;
const int maxAuthAttempts = 3;

// Server Callbacks
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      isAuthenticated = false;
      authAttempts = 0;
      
      Serial.println("");
      Serial.println("========================================");
      Serial.println("CLIENT CONNECTED!");
      Serial.println("========================================");
      Serial.println("Waiting for authentication...");
      
      // Send AUTH_REQUIRED status
      pStatusCharacteristic->setValue("AUTH_REQUIRED");
      pStatusCharacteristic->notify();
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      isAuthenticated = false;
      authAttempts = 0;
      
      Serial.println("");
      Serial.println("========================================");
      Serial.println("CLIENT DISCONNECTED");
      Serial.println("========================================");
      
      // Restart advertising
      BLEDevice::startAdvertising();
      Serial.println("Advertising restarted. Waiting for connection...");
    }
};

// Authentication Characteristic Callback
class AuthCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String value = pCharacteristic->getValue().c_str();
      
      if (value.length() > 0) {
        String receivedPassword = value;
        receivedPassword.trim();
        
        Serial.println("Authentication attempt received");
        Serial.println("Password length: " + String(receivedPassword.length()));
        Serial.println("Expected: [" + devicePassword + "]");
        Serial.println("Received: [" + receivedPassword + "]");
        
        if (receivedPassword == devicePassword) {
          isAuthenticated = true;
          authAttempts = 0;
          
          Serial.println("");
          Serial.println("✓✓✓ AUTHENTICATION SUCCESSFUL ✓✓✓");
          Serial.println("Secure connection established!");
          Serial.println("");
          
          pStatusCharacteristic->setValue("AUTH_SUCCESS");
          pStatusCharacteristic->notify();
          
        } else {
          authAttempts++;
          
          Serial.println("");
          Serial.println("✗ AUTHENTICATION FAILED");
          Serial.println("Attempt: " + String(authAttempts) + "/" + String(maxAuthAttempts));
          Serial.println("");
          
          if (authAttempts >= maxAuthAttempts) {
            Serial.println("⚠ MAX ATTEMPTS REACHED");
            pStatusCharacteristic->setValue("AUTH_FAILED_MAX");
            pStatusCharacteristic->notify();
            delay(100);
            pServer->disconnect(pServer->getConnId());
          } else {
            String attemptsLeft = String(maxAuthAttempts - authAttempts);
            pStatusCharacteristic->setValue(("AUTH_FAILED:" + attemptsLeft).c_str());
            pStatusCharacteristic->notify();
          }
        }
      }
    }
};

// Data Characteristic Callback (for receiving data)
class DataCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      if (!isAuthenticated) {
        Serial.println("⚠ Received data but not authenticated!");
        return;
      }
      
      String value = pCharacteristic->getValue().c_str();
      
      if (value.length() > 0) {
        String receivedData = value;
        Serial.println("Received data: " + receivedData);
        
        // Echo back
        String response = "ESP32: " + receivedData;
        pDataCharacteristic->setValue(response.c_str());
        pDataCharacteristic->notify();
      }
    }
};

void setup() {
  Serial.begin(115200);
  Serial.println("");
  Serial.println("=== ESP32 BLE Healthcare Device ===");
  Serial.println("Initializing...");

  // Create BLE Device
  BLEDevice::init("ESP32_Health");

  // Create BLE Server
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // Create BLE Service
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Create Authentication Characteristic (Write)
  pAuthCharacteristic = pService->createCharacteristic(
                      AUTH_CHAR_UUID,
                      BLECharacteristic::PROPERTY_WRITE
                    );
  pAuthCharacteristic->setCallbacks(new AuthCallbacks());

  // Create Data Characteristic (Read/Write/Notify)
  pDataCharacteristic = pService->createCharacteristic(
                      DATA_CHAR_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_WRITE  |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pDataCharacteristic->addDescriptor(new BLE2902());
  pDataCharacteristic->setCallbacks(new DataCallbacks());

  // Create Status Characteristic (Read/Notify)
  pStatusCharacteristic = pService->createCharacteristic(
                      STATUS_CHAR_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pStatusCharacteristic->addDescriptor(new BLE2902());

  // Start the service
  pService->start();

  // Start advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(false);
  pAdvertising->setMinPreferred(0x0);
  BLEDevice::startAdvertising();
  
  Serial.println("BLE Server started!");
  Serial.println("Device name: ESP32_Health");
  Serial.println("Password: " + devicePassword);
  Serial.println("Waiting for connection...");
}

void loop() {
  // If authenticated, you can send data periodically
  if (deviceConnected && isAuthenticated) {
    // Example: Send some health data every 5 seconds
    static unsigned long lastSendTime = 0;
    if (millis() - lastSendTime > 5000) {
      String healthData = "HeartRate:75,SpO2:98";
      pDataCharacteristic->setValue(healthData.c_str());
      pDataCharacteristic->notify();
      Serial.println("Sent: " + healthData);
      lastSendTime = millis();
    }
  }
  
  delay(100);
}
