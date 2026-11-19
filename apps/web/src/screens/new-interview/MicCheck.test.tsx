import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MicCheck } from './MicCheck';
import { getPreferredMicId, setPreferredMicId, PREFERRED_MIC_STORAGE_KEY } from '@/lib/audio';

describe('MicCheck Component (VI-4, #143)', () => {
  let mockTrack: { stop: ReturnType<typeof vi.fn> };
  let mockStream: { getTracks: ReturnType<typeof vi.fn> };
  let mockAnalyser: {
    fftSize: number;
    smoothingTimeConstant: number;
    frequencyBinCount: number;
    getByteFrequencyData: ReturnType<typeof vi.fn>;
  };
  let mockAudioContext: {
    createMediaStreamSource: ReturnType<typeof vi.fn>;
    createAnalyser: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    state: string;
  };
  let mockGetUserMedia: ReturnType<typeof vi.fn>;
  let mockEnumerateDevices: ReturnType<typeof vi.fn>;
  let rafCallback: FrameRequestCallback | null = null;

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();

    mockTrack = { stop: vi.fn() };
    mockStream = { getTracks: vi.fn(() => [mockTrack]) };

    mockAnalyser = {
      fftSize: 256,
      smoothingTimeConstant: 0.4,
      frequencyBinCount: 16,
      getByteFrequencyData: vi.fn((array: Uint8Array) => {
        // default: simulate moderate sound so levelPct > 8
        array.fill(40);
      }),
    };

    class MockAudioContextClass {
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
      createAnalyser = vi.fn(() => mockAnalyser);
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      state = 'running';

      constructor() {
        mockAudioContext = this as unknown as typeof mockAudioContext;
      }
    }

    vi.stubGlobal('AudioContext', MockAudioContextClass);

    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCallback = cb;
        return 999;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
    mockEnumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: 'mic-internal', kind: 'audioinput', label: 'MacBook Pro Microphone' },
      { deviceId: 'mic-usb', kind: 'audioinput', label: 'USB Condenser Mic' },
      { deviceId: 'speaker-1', kind: 'audiooutput', label: 'Internal Speakers' },
    ]);

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: mockGetUserMedia,
        enumerateDevices: mockEnumerateDevices,
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders title, description, and initial inactive state', async () => {
    render(<MicCheck />);

    expect(screen.getByText('Microphone Check')).toBeInTheDocument();
    expect(
      screen.getByText(/Pick and test your microphone before entering the interview/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test Microphone' })).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();

    // Verifies devices were enumerated and loaded into the select
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'MacBook Pro Microphone' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'USB Condenser Mic' })).toBeInTheDocument();
      // audiooutput device must be excluded
      expect(screen.queryByRole('option', { name: 'Internal Speakers' })).not.toBeInTheDocument();
    });
  });

  it('starts audio test, connects AnalyserNode, and detects sound on animation frame', async () => {
    render(<MicCheck />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'MacBook Pro Microphone' })).toBeInTheDocument();
    });

    const testButton = screen.getByRole('button', { name: 'Test Microphone' });
    await act(async () => {
      fireEvent.click(testButton);
    });

    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'mic-internal' } },
    });
    expect(screen.getByRole('button', { name: 'Stop Test' })).toBeInTheDocument();
    expect(screen.getByText('Listening...')).toBeInTheDocument();

    // Trigger an animation frame loop to calculate level and sound detection
    act(() => {
      rafCallback?.(100);
    });

    expect(screen.getByText('Sound Detected')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sound Detected');
    expect(screen.getByText(/✅ Microphone is working properly\./i)).toBeInTheDocument();
  });

  it('stops testing when clicking Stop Test and cleans up tracks and AudioContext', async () => {
    render(<MicCheck />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'MacBook Pro Microphone' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test Microphone' }));
    });

    expect(screen.getByRole('button', { name: 'Stop Test' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop Test' }));
    });

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mockAudioContext.close).toHaveBeenCalled();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(999);
    expect(screen.getByRole('button', { name: 'Test Microphone' })).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('switching microphone updates sessionStorage and restarts active test with new deviceId', async () => {
    const handleDeviceChange = vi.fn();
    render(<MicCheck onDeviceChange={handleDeviceChange} />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'USB Condenser Mic' })).toBeInTheDocument();
    });

    // Start testing with first device
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test Microphone' }));
    });

    expect(mockGetUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: 'mic-internal' } },
    });

    // Change to USB mic
    const select = screen.getByLabelText('Select Input Device');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'mic-usb' } });
    });

    // Stored in sessionStorage and fired callback
    expect(getPreferredMicId()).toBe('mic-usb');
    expect(sessionStorage.getItem(PREFERRED_MIC_STORAGE_KEY)).toBe('mic-usb');
    expect(handleDeviceChange).toHaveBeenCalledWith('mic-usb');

    // Automatically restarts test with new device
    expect(mockGetUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: 'mic-usb' } },
    });
  });

  it('pre-selects previously stored preferred microphone from sessionStorage on mount', async () => {
    setPreferredMicId('mic-usb');

    render(<MicCheck />);

    await waitFor(() => {
      const select = screen.getByLabelText('Select Input Device') as HTMLSelectElement;
      expect(select.value).toBe('mic-usb');
    });
  });

  it('displays error alert when getUserMedia permission is denied', async () => {
    mockGetUserMedia.mockRejectedValueOnce(new Error('Permission denied by user'));

    render(<MicCheck />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test Microphone' }));
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Microphone Access Required')).toBeInTheDocument();
    expect(screen.getByText('Permission denied by user')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test Microphone' })).toBeInTheDocument();
  });

  it('cleans up stream and audio context on component unmount', async () => {
    const { unmount } = render(<MicCheck />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test Microphone' }));
    });

    unmount();

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mockAudioContext.close).toHaveBeenCalled();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('handles first visit with unlabeled devices and updates device list after granting permission', async () => {
    // Before permission: unlabeled/empty device
    mockEnumerateDevices.mockResolvedValueOnce([
      { deviceId: '', kind: 'audioinput', label: '' },
    ]);
    // After permission: labeled device returned
    mockEnumerateDevices.mockResolvedValueOnce([
      { deviceId: 'mic-airpods', kind: 'audioinput', label: 'AirPods Pro Microphone' },
    ]);

    render(<MicCheck />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Microphone 1' })).toBeInTheDocument();
    });

    const testButton = screen.getByRole('button', { name: 'Test Microphone' });
    await act(async () => {
      fireEvent.click(testButton);
    });

    // Verifies devices were refreshed and updated to the labeled device
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'AirPods Pro Microphone' })).toBeInTheDocument();
      // Verifies testing remains active without resetting to inactive
      expect(screen.getByRole('button', { name: 'Stop Test' })).toBeInTheDocument();
    });
  });

  it('stops tracks immediately if component unmounts while getUserMedia is pending', async () => {
    let resolveGUM!: (stream: unknown) => void;
    mockGetUserMedia.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGUM = resolve;
      })
    );

    const { unmount } = render(<MicCheck />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test Microphone' }));
    });

    // Unmount while waiting for user permission dialog
    unmount();

    // Now user grants permission
    await act(async () => {
      resolveGUM(mockStream);
    });

    // Verify stream was immediately stopped to prevent orphaned recording
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it('refreshes devices when devicechange event fires', async () => {
    let deviceChangeHandler: (() => void) | null = null;
    const addEventListenerMock = vi.fn((event: string, handler: () => void) => {
      if (event === 'devicechange') {
        deviceChangeHandler = handler;
      }
    });
    const removeEventListenerMock = vi.fn();

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: mockGetUserMedia,
        enumerateDevices: mockEnumerateDevices,
        addEventListener: addEventListenerMock,
        removeEventListener: removeEventListenerMock,
      },
      configurable: true,
    });

    const { unmount } = render(<MicCheck />);

    await waitFor(() => {
      expect(addEventListenerMock).toHaveBeenCalledWith('devicechange', expect.any(Function));
    });

    // Simulate plugging in a new device
    mockEnumerateDevices.mockResolvedValueOnce([
      { deviceId: 'mic-headset', kind: 'audioinput', label: 'Wired Headset Mic' },
    ]);

    await act(async () => {
      deviceChangeHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Wired Headset Mic' })).toBeInTheDocument();
    });

    unmount();
    expect(removeEventListenerMock).toHaveBeenCalledWith('devicechange', expect.any(Function));
  });
});
