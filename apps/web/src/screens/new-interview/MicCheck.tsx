import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getPreferredMicId, setPreferredMicId } from '@/lib/audio';

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface MicCheckProps {
  /** Optional callback fired when the selected microphone changes. */
  onDeviceChange?: (deviceId: string) => void;
  className?: string;
}

export const MicCheck: React.FC<MicCheckProps> = ({ onDeviceChange, className }) => {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => getPreferredMicId() ?? '');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [hasDetectedSound, setHasDetectedSound] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Stop active stream and release audio context cleanly
  const stopAudio = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
    setIsTesting(false);
  }, []);

  // Update devices list from navigator.mediaDevices.enumerateDevices
  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter((d) => d.kind === 'audioinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${index + 1}`,
        }));
      setDevices(audioInputs);

      // If no device currently selected, default to the first or preferred
      const stored = getPreferredMicId();
      if (stored && audioInputs.some((d) => d.deviceId === stored)) {
        setSelectedDeviceId(stored);
      } else if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId);
        setPreferredMicId(audioInputs[0].deviceId);
      }
    } catch {
      // Ignore enumeration errors
    }
  }, [selectedDeviceId]);

  // Start capturing audio from selectedDeviceId and analyze level
  const startAudio = useCallback(
    async (deviceIdToUse?: string) => {
      stopAudio();
      setPermissionError(null);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setPermissionError('Audio input is not supported in this browser environment.');
        return;
      }

      const targetDeviceId = deviceIdToUse ?? selectedDeviceId;

      try {
        const constraints: MediaStreamConstraints = {
          audio: targetDeviceId ? { deviceId: { exact: targetDeviceId } } : true,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        setIsTesting(true);

        // Re-read devices now that permission is definitely granted (reveals labels)
        await refreshDevices();

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;

        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;

        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkLevel = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);

          // Calculate average energy
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Scale roughly to 0..100 percentage
          const levelPct = Math.min(100, Math.round((avg / 128) * 100));
          setAudioLevel(levelPct);

          if (levelPct > 8) {
            setHasDetectedSound(true);
          }

          rafIdRef.current = requestAnimationFrame(checkLevel);
        };

        rafIdRef.current = requestAnimationFrame(checkLevel);
      } catch (err) {
        stopAudio();
        const msg =
          err instanceof Error
            ? err.message
            : 'Could not access microphone. Please grant microphone permissions in your browser.';
        setPermissionError(msg);
      }
    },
    [refreshDevices, selectedDeviceId, stopAudio]
  );

  // Initialize: enumerate devices on mount
  useEffect(() => {
    refreshDevices();
    return () => {
      stopAudio();
    };
  }, [refreshDevices, stopAudio]);

  // Handle device selection change
  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelectedDeviceId(newId);
    setPreferredMicId(newId);
    setHasDetectedSound(false);
    onDeviceChange?.(newId);

    // If already testing, restart with new device
    if (isTesting) {
      void startAudio(newId);
    }
  };

  return (
    <Card className={className} data-slot="mic-check">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span>🎙️</span>
            <span>Microphone Check</span>
          </CardTitle>
          {isTesting && (
            <Badge variant={hasDetectedSound ? 'default' : 'secondary'} className="text-xs">
              {hasDetectedSound ? 'Sound Detected' : 'Listening...'}
            </Badge>
          )}
        </div>
        <CardDescription>
          Pick and test your microphone before entering the interview to prevent silent audio failures.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {permissionError && (
          <Alert variant="error">
            <AlertTitle>Microphone Access Required</AlertTitle>
            <AlertDescription>{permissionError}</AlertDescription>
          </Alert>
        )}

        {/* Device Selector */}
        <div className="space-y-1.5">
          <label htmlFor="mic-select" className="text-xs font-medium text-muted-foreground">
            Select Input Device
          </label>
          <select
            id="mic-select"
            aria-label="Select Input Device"
            value={selectedDeviceId}
            onChange={handleDeviceChange}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {devices.length === 0 ? (
              <option value="">Default Microphone</option>
            ) : (
              devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Level Meter Progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Input Level</span>
            <span className="font-mono">{isTesting ? `${audioLevel}%` : 'Inactive'}</span>
          </div>
          <Progress
            value={audioLevel}
            aria-label="Microphone input level"
            className="h-2.5 transition-all"
          />
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            {isTesting
              ? hasDetectedSound
                ? '✅ Microphone is working properly.'
                : 'Speak into your microphone to verify audio pickup.'
              : 'Click below to test your microphone.'}
          </p>

          <Button
            type="button"
            variant={isTesting ? 'outline' : 'default'}
            size="sm"
            onClick={isTesting ? stopAudio : () => void startAudio()}
          >
            {isTesting ? 'Stop Test' : 'Test Microphone'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
