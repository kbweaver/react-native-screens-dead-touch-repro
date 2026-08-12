/**
 * Reproduces a react-native-screens bug (Android, New Architecture):
 * after the software keyboard opens and closes on Screen C, every Pressable
 * on Screen B stops working for real finger taps.
 *
 * Requires `edgeToEdgeEnabled=false` (android/gradle.properties) so the
 * keyboard resizes the window (`windowSoftInputMode="adjustResize"`).
 * See the repo README for the mechanism and the split-screen variant that
 * reproduces the same bug with edge-to-edge enabled.
 */
import React, {useState, useEffect} from 'react';
import {Pressable, ScrollView, Text, TextInput} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

// Tall navigation targets: scripted taps tolerate layout differences.
const NAV_BUTTON = {
  height: 120,
  marginBottom: 12,
  justifyContent: 'center' as const,
  padding: 16,
};

const STEP = {fontSize: 15, lineHeight: 22, marginBottom: 10};

/**
 * Deliberately short rows with zero press-retention slop: the bug cancels a
 * press only when the (jittering) touch exits the stale measured rect, so
 * tall targets or generous slop would mask it.
 */
function Row({label}: {label: string}) {
  const [pressIns, setPressIns] = useState(0);
  const [presses, setPresses] = useState(0);
  return (
    <Pressable
      pressRetentionOffset={{top: 0, bottom: 0, left: 0, right: 0}}
      onPressIn={() => {
        console.log(`pressIn ${label}`);
        setPressIns(n => n + 1);
      }}
      onPress={() => {
        console.log(`press ${label}`);
        setPresses(n => n + 1);
      }}
      style={({pressed}) => ({
        height: 24,
        justifyContent: 'center',
        paddingHorizontal: 16,
        marginBottom: 12,
        backgroundColor: pressed ? '#aaccff' : '#e8e8e8',
      })}>
      <Text>
        {label} — pressIn: {pressIns} / press: {presses}
        {pressIns > presses ? '   << pressIn without press = BUG' : ''}
      </Text>
    </Pressable>
  );
}

function ScreenA({navigation}: any) {
  return (
    <ScrollView contentContainerStyle={{padding: 16}}>
      <Pressable
        onPress={() => navigation.navigate('B')}
        style={{...NAV_BUTTON, backgroundColor: '#2196f3'}}>
        <Text style={{color: 'white'}}>GO TO SCREEN B</Text>
      </Pressable>
      <Text style={STEP}>
        This app reproduces a react-native-screens bug: after the keyboard
        opens and closes on Screen C, everything on Screen B stops responding
        to finger taps.
      </Text>
      <Text style={STEP}>Step 1: Tap GO TO SCREEN B.</Text>
      <Text style={STEP}>
        (Screen B must not be the first screen in the stack — that is why this
        screen exists.)
      </Text>
    </ScrollView>
  );
}

function ScreenB({navigation}: any) {
  // Simulates a busy app: guarantees React commits land while the keyboard
  // animates on Screen C. Capped so the UI eventually idles.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => (t < 480 ? t + 1 : t)), 250);
    return () => clearInterval(id);
  }, []);

  return (
    <ScrollView contentContainerStyle={{padding: 16}}>
      <Pressable
        onPress={() => navigation.navigate('C')}
        style={{...NAV_BUTTON, backgroundColor: '#2196f3'}}>
        <Text style={{color: 'white'}}>OPEN SCREEN C — tick: {tick}</Text>
      </Pressable>
      <Row label="row 1" />
      <Row label="row 2" />
      <Text style={STEP}>
        Step 2: Tap row 1 and row 2. Each tap increments both counters
        (pressIn and press).
      </Text>
      <Text style={STEP}>Step 3: Tap OPEN SCREEN C and follow the steps there.</Text>
      <Text style={STEP}>
        Step 6 (after returning from Screen C): Tap the rows again.
      </Text>
      <Text style={STEP}>
        Expected: both counters increment, as in Step 2. Actual: the row
        highlights and pressIn increments, but press does not — the tap is
        cancelled. Every Pressable on this screen is affected.
      </Text>
      <Text style={STEP}>
        Use a real finger. Emulator mouse clicks do not show the bug because
        they produce no touch-move events; simulate a finger with:{'\n'}
        adb shell input swipe X Y X+5 Y+5 100
      </Text>
      <Text style={STEP}>
        Rotating the device fixes the screen. Events also log to logcat:{'\n'}
        adb logcat -s ReactNativeJS
      </Text>
    </ScrollView>
  );
}

function ScreenC() {
  // ScrollView so the tap in Step 5 dismisses the keyboard
  // (keyboardShouldPersistTaps defaults to 'never').
  return (
    <ScrollView contentContainerStyle={{flexGrow: 1, padding: 16}}>
      <TextInput
        placeholder="Step 4: Tap here so the keyboard opens"
        style={{...NAV_BUTTON, borderWidth: 1}}
      />
      <Text style={STEP}>
        Step 5: Tap here (outside the input) so the keyboard closes, then go
        back to Screen B.
      </Text>
    </ScrollView>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="A" component={ScreenA} />
        <Stack.Screen name="B" component={ScreenB} />
        <Stack.Screen name="C" component={ScreenC} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
