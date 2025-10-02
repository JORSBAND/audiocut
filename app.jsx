import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, X, FileUp, Loader, SlidersHorizontal, Download, Volume2, Waves, Repeat, Aperture, Minus, Split, Zap, Speaker } from 'lucide-react';

// --- Утиліти Web Audio API ---

// Утиліта для створення імпульсної відповіді (Impulse Response) для Reverb
const buildReverbImpulse = (audioContext, duration, decay, reverse) => {
  const sampleRate = audioContext.sampleRate;
  const length = sampleRate * duration;
  const impulse = audioContext.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    let n = reverse ? length - i : i;
    left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
  }
  return impulse;
};

// Утиліта для Waveshaper Distortion
const makeDistortionCurve = (amount) => {
    let k = typeof amount === 'number' ? amount : 50,
        n_samples = 44100,
        curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        let x = i * 2 / n_samples - 1;
        curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
};

// Утиліта для кодування AudioBuffer у файл WAV
const audioBufferToWav = (buffer) => {
  const numOfChan = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const len = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(len);
  const view = new DataView(bufferArray);

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF'); 
  view.setUint32(4, len - 8, true); 
  writeString(view, 8, 'WAVE'); 

  // FMT sub-chunk
  writeString(view, 12, 'fmt '); 
  view.setUint32(16, 16, true); 
  view.setUint16(20, 1, true); 
  view.setUint16(22, numOfChan, true); 
  view.setUint32(24, rate, true); 
  view.setUint32(28, rate * numOfChan * 2, true); 
  view.setUint16(32, numOfChan * 2, true); 
  view.setUint16(34, 16, true); 

  // DATA sub-chunk
  writeString(view, 36, 'data'); 
  view.setUint32(40, buffer.length * numOfChan * 2, true); 

  // Запис даних PCM (16-бітний)
  let offset = 44;
  const channels = [];
  for (let i = 0; i < numOfChan; i++) {
    channels.push(buffer.getChannelData(i));
  }
  
  for (let i = 0; i < buffer.length; i++) {
    for (let j = 0; j < numOfChan; j++) {
      const sample = Math.max(-1, Math.min(1, channels[j][i]));
      view.setInt16(offset, sample * 0x7FFF, true); 
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
};

// --- Головний Компонент ---
const App = () => {
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [audioContext, setAudioContext] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canvasWrapperRef = useRef(null);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 800, height: 160 });

  // Параметри обрізання
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  
  // Час відтворення/Курсор
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0); // Візуальна позиція курсора
  const playbackStartTimeRef = useRef(0); // Час, коли почалося відтворення контексту
  const playbackOffsetRef = useRef(0); // Офсет, з якого почалося відтворення в буфері (startTime)
  const animationFrameRef = useRef(null);
  const isDraggingRef = useRef(null); // 'start', 'end', or null

  // Параметри Fade In/Out
  const [isFadeInEnabled, setIsFadeInEnabled] = useState(false);
  const [fadeInDuration, setFadeInDuration] = useState(0.5); 
  const [isFadeOutEnabled, setIsFadeOutEnabled] = useState(false);
  const [fadeOutDuration, setFadeOutDuration] = useState(0.5); 

  // Параметри EQ/Filters
  const [isEqEnabled, setIsEqEnabled] = useState(true);
  const [bassGain, setBassGain] = useState(0);
  const [trebleGain, setTrebleGain] = useState(0);

  const [isHpfEnabled, setIsHpfEnabled] = useState(false);
  const [hpfFreq, setHpfFreq] = useState(80); 

  // Нові параметри (Compressor & Panner)
  const [isCompressorEnabled, setIsCompressorEnabled] = useState(false);
  const [compThreshold, setCompThreshold] = useState(-24); // dB
  const [compRatio, setCompRatio] = useState(4); // 4:1

  const [isPannerEnabled, setIsPannerEnabled] = useState(false);
  const [panValue, setPanValue] = useState(0); // -1 (Left) to 1 (Right)

  // Нові параметри Distortion
  const [isDistortionEnabled, setIsDistortionEnabled] = useState(false);
  const [distortionAmount, setDistortionAmount] = useState(50); // 0 to 100

  // Параметри Ефектів
  const [isReverbEnabled, setIsReverbEnabled] = useState(false);
  const [reverbAmount, setReverbAmount] = useState(0.2); 
  
  const [isDelayEnabled, setIsDelayEnabled] = useState(false);
  const [delayTime, setDelayTime] = useState(0.5); 
  const [delayFeedback, setDelayFeedback] = useState(0.3); 
  
  const [isFlangerEnabled, setIsFlangerEnabled] = useState(false);
  const [flangerDepth, setFlangerDepth] = useState(0.005); 
  const [flangerRate, setFlangerRate] = useState(1); 
  const [flangerMix, setFlangerMix] = useState(0.5); 

  const [masterGain, setMasterGain] = useState(1);
  
  // Рефи для Web Audio API та Canvas
  const sourceRef = useRef(null);
  const canvasRef = useRef(null);
  const nodesRef = useRef({});

  // --- Playhead Animation Loop ---
  const animatePlayhead = useCallback(() => {
    if (!audioContext || !audioBuffer) return;

    if (isPlaying) {
      const elapsed = audioContext.currentTime - playbackStartTimeRef.current;
      let newTime = playbackOffsetRef.current + elapsed;

      // Зупиняємо, якщо вийшли за межі обрізання
      if (newTime >= endTime) {
        stopPlayback(true); // Передаємо true, щоб не обнуляти startTime
        newTime = endTime; 
      }
      setCurrentPlaybackTime(newTime);
    }
    animationFrameRef.current = requestAnimationFrame(animatePlayhead);
  }, [audioContext, audioBuffer, isPlaying, endTime]);

  // Запуск/зупинка циклу анімації
  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animatePlayhead);
    } else {
      cancelAnimationFrame(animationFrameRef.current);
    }
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying, animatePlayhead]);


  // Ініціалізація AudioContext
  useEffect(() => {
    if (!audioContext) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      setAudioContext(ctx);
    }
  }, [audioContext]);
  
  // Функція Скидання Стану
  const resetState = () => {
    if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch (e) { /* ignore */ }
    }
    setAudioBuffer(null);
    setIsPlaying(false);
    setStartTime(0);
    setEndTime(0);
    setCurrentPlaybackTime(0); // Скидаємо курсор
    playbackOffsetRef.current = 0;
    playbackStartTimeRef.current = 0;
    
    // ... скидання інших параметрів
    setIsFadeInEnabled(false);
    setFadeInDuration(0.5);
    setIsFadeOutEnabled(false);
    setFadeOutDuration(0.5);
    setBassGain(0);
    setTrebleGain(0);
    setIsHpfEnabled(false);
    setHpfFreq(80);
    setIsCompressorEnabled(false);
    setCompThreshold(-24);
    setCompRatio(4);
    setIsPannerEnabled(false);
    setPanValue(0);
    setIsDistortionEnabled(false);
    setDistortionAmount(50);
    setIsReverbEnabled(false);
    setReverbAmount(0.2);
    setIsDelayEnabled(false);
    setDelayTime(0.5);
    setDelayFeedback(0.3);
    setIsFlangerEnabled(false);
    setFlangerDepth(0.005); 
    setFlangerRate(1); 
    setFlangerMix(0.5);
    setMasterGain(1);
    setError('');
    setLoading(false);
    sourceRef.current = null;
  };

  // --- 1. Адаптивність Canvas та Візуалізація ---
  const drawWaveform = useCallback((buffer, width, height, currentTime) => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;

    // Оновлення розміру Canvas
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    const data = buffer.getChannelData(0); 

    const step = Math.ceil(data.length / width);
    const amp = height / 2;
    const duration = buffer.duration;

    ctx.clearRect(0, 0, width, height);
    
    // 1. Фон обрізаної області (Світліший синій)
    const startX = (startTime / duration) * width;
    const endX = (endTime / duration) * width;
    
    ctx.fillStyle = 'rgba(23, 120, 192, 0.3)'; 
    ctx.fillRect(startX, 0, endX - startX, height);

    // 2. Малювання хвильової форми
    ctx.strokeStyle = '#10B981'; 
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      const offset = i * step;

      for (let j = 0; j < step; j++) {
        const datum = data[offset + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      
      if (i === 0) {
        ctx.moveTo(i, (1 + min) * amp);
      } else {
        ctx.lineTo(i, (1 + max) * amp);
        ctx.lineTo(i, (1 + min) * amp); 
        ctx.moveTo(i, (1 + max) * amp);
      }
    }
    ctx.stroke();

    // 3. Малювання обмежуючих ліній та Playhead
    ctx.strokeStyle = '#065f46'; 
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, amp);
    ctx.lineTo(width, amp);
    ctx.stroke();

    // 4. Playhead (Курсор)
    if (buffer) {
        const playheadX = (currentTime / duration) * width;
        ctx.fillStyle = '#f87171'; // Червоний
        ctx.fillRect(playheadX - 1, 0, 2, height);
    }
    
    // 5. Обмежувальні маркери обрізання (Сині)
    // Малюємо поверх курсора, якщо вони співпадають
    ctx.fillStyle = '#0ea5e9'; // Синій
    ctx.fillRect(startX - 2, 0, 4, height); // Start Marker
    ctx.fillRect(endX - 2, 0, 4, height); // End Marker


  }, [startTime, endTime]);
  
  // Observer для адаптивності Canvas
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    const updateCanvasSize = () => {
      const rect = wrapper.getBoundingClientRect();
      const newWidth = rect.width;
      const newHeight = 160; 
      setCanvasDimensions({ width: newWidth, height: newHeight });
    };

    updateCanvasSize(); // Встановити розмір при монтуванні

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(wrapper);

    return () => observer.disconnect();
  }, []);

  // Ефект для оновлення візуалізації (включаючи курсор)
  useEffect(() => {
    if (audioBuffer) {
      drawWaveform(audioBuffer, canvasDimensions.width, canvasDimensions.height, currentPlaybackTime);
    }
  }, [audioBuffer, startTime, endTime, drawWaveform, canvasDimensions, currentPlaybackTime]);


  // --- 2. Створення Аудіо Графу (Мікшер) ---
  const createAudioGraph = useCallback((context, buffer, initialStates) => {
    const { 
        isHpfEnabled, isEqEnabled, isDistortionEnabled, isCompressorEnabled, isPannerEnabled, 
        isReverbEnabled, isDelayEnabled, isFlangerEnabled, 
        bassGain, trebleGain, hpfFreq, compThreshold, compRatio, panValue, distortionAmount, 
        reverbAmount, delayTime, delayFeedback, flangerDepth, flangerRate, flangerMix, masterGain
    } = initialStates;
    
    const source = context.createBufferSource();
    source.buffer = buffer;
    
    // Нода для Fade In/Out
    const preFXGain = context.createGain();
    preFXGain.gain.setValueAtTime(1.0, context.currentTime); 
    
    // 1. Фільтри та EQ
    const hpfFilter = context.createBiquadFilter();
    hpfFilter.type = 'highpass';
    hpfFilter.frequency.setValueAtTime(parseFloat(hpfFreq), context.currentTime);

    const bassFilter = context.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.setValueAtTime(120, context.currentTime);
    bassFilter.gain.setValueAtTime(parseFloat(bassGain), context.currentTime);

    const trebleFilter = context.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.setValueAtTime(8000, context.currentTime);
    trebleFilter.gain.setValueAtTime(parseFloat(trebleGain), context.currentTime);

    // 2. Ефекти
    // Compressor
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(parseFloat(compThreshold), context.currentTime);
    compressor.ratio.setValueAtTime(parseFloat(compRatio), context.currentTime);

    // Stereo Panner
    const panner = context.createStereoPanner();
    panner.pan.setValueAtTime(parseFloat(panValue), context.currentTime);

    // Distortion
    const distortion = context.createWaveShaper();
    distortion.curve = makeDistortionCurve(isDistortionEnabled ? parseFloat(distortionAmount) : 0);
    
    // Reverb
    const convolver = context.createConvolver();
    // Використовуємо існуючий імпульс, якщо є
    const impulse = context instanceof AudioContext ? nodesRef.current.reverbImpulse : buildReverbImpulse(context, 3, 1.5, false);
    convolver.buffer = impulse;
    if (context instanceof AudioContext) nodesRef.current.reverbImpulse = impulse; // Зберігаємо для Live Context

    const wetGainReverb = context.createGain();
    wetGainReverb.gain.setValueAtTime(isReverbEnabled ? parseFloat(reverbAmount) : 0, context.currentTime); 

    // Delay
    const delay = context.createDelay(1.0); 
    delay.delayTime.setValueAtTime(parseFloat(delayTime), context.currentTime);
    const delayFeedbackGain = context.createGain();
    delayFeedbackGain.gain.setValueAtTime(isDelayEnabled ? parseFloat(delayFeedback) : 0, context.currentTime);
    const wetGainDelay = context.createGain();
    wetGainDelay.gain.setValueAtTime(isDelayEnabled ? 1.0 : 0, context.currentTime); 

    // Flanger
    const flangerDelay = context.createDelay(0.02); 
    const flangerLFO = context.createOscillator();
    const flangerLfoDepthGain = context.createGain(); 
    const flangerFeedbackGain = context.createGain(); 
    const wetGainFlanger = context.createGain(); 

    flangerDelay.delayTime.setValueAtTime(0.001, context.currentTime); 
    flangerLFO.type = 'sine';
    flangerLFO.frequency.setValueAtTime(parseFloat(flangerRate), context.currentTime);
    flangerLfoDepthGain.gain.setValueAtTime(isFlangerEnabled ? parseFloat(flangerDepth) : 0, context.currentTime);
    flangerFeedbackGain.gain.setValueAtTime(0.5, context.currentTime); 
    wetGainFlanger.gain.setValueAtTime(isFlangerEnabled ? parseFloat(flangerMix) : 0, context.currentTime); 
    
    if (context instanceof AudioContext) {
        if (!nodesRef.current.flangerLFO) {
             flangerLFO.start(0);
             nodesRef.current.flangerLFO = flangerLFO;
        }
    } else {
        flangerLFO.start(0);
    }

    // 3. Master та Routing
    const dryGain = context.createGain();
    dryGain.gain.setValueAtTime(1.0, context.currentTime); 
    const masterGainNode = context.createGain();
    masterGainNode.gain.setValueAtTime(parseFloat(masterGain), context.currentTime);

    // --- Ланцюжок Підключень ---
    
    // A. Source -> PreFXGain
    source.connect(preFXGain);

    // B. DRY/Main Chain (PreFXGain -> [HPF] -> [EQ] -> [Distortion] -> [Compressor] -> [Panner])
    let currentNode = preFXGain;
    
    if (isHpfEnabled) {
        currentNode.connect(hpfFilter);
        currentNode = hpfFilter;
    }
    
    if (isEqEnabled) {
        currentNode.connect(bassFilter);
        bassFilter.connect(trebleFilter);
        currentNode = trebleFilter;
    }
    
    if (isDistortionEnabled) { 
        currentNode.connect(distortion);
        currentNode = distortion;
    }

    if (isCompressorEnabled) {
        currentNode.connect(compressor);
        currentNode = compressor;
    }

    if (isPannerEnabled) {
        currentNode.connect(panner);
        currentNode = panner;
    }

    const mainSignal = currentNode; 
    
    // C. Паралельні шляхи для ефектів (від mainSignal)
    mainSignal.connect(dryGain);
    mainSignal.connect(convolver); 
    mainSignal.connect(delay); 
    mainSignal.connect(flangerDelay);
    
    // D. Routing Ефектів та Feedback Loops
    convolver.connect(wetGainReverb);

    wetGainDelay.connect(delayFeedbackGain);
    delayFeedbackGain.connect(delay); // Delay Feedback Loop
    delay.connect(wetGainDelay); 

    flangerLFO.connect(flangerLfoDepthGain);
    flangerLfoDepthGain.connect(flangerDelay.delayTime); 
    flangerDelay.connect(flangerFeedbackGain);
    flangerFeedbackGain.connect(flangerDelay); 
    flangerDelay.connect(wetGainFlanger);

    // 4. Змішування на Master Node
    dryGain.connect(masterGainNode);
    wetGainReverb.connect(masterGainNode);
    wetGainDelay.connect(masterGainNode);
    wetGainFlanger.connect(masterGainNode);

    // 5. Master -> Destination
    masterGainNode.connect(context.destination);

    return { 
        source, preFXGain, hpfFilter, bassFilter, trebleFilter, compressor, panner, distortion,
        convolver, // <--- ВИПРАВЛЕННЯ: Тепер зберігаємо convolver для коректного відключення/перепідключення.
        wetGainReverb, masterGainNode,
        delay, delayFeedbackGain, wetGainDelay,
        flangerLFO, flangerLfoDepthGain, wetGainFlanger
    };
  }, []); 


  // --- 3. Оновлення Live Playback Нодів (Тільки параметри, без зупинки) ---
  useEffect(() => {
    // Додаємо convolver до деструктуризації
    const { masterGainNode, hpfFilter, bassFilter, trebleFilter, compressor, panner, distortion, convolver, wetGainReverb, delay, delayFeedbackGain, wetGainDelay, flangerLFO, flangerLfoDepthGain, wetGainFlanger } = nodesRef.current;
    if (!audioContext || !masterGainNode) return;
    
    // Оновлення Filters/EQ/Dynamics/Spatial
    hpfFilter.frequency.setValueAtTime(parseFloat(hpfFreq), audioContext.currentTime);
    bassFilter.gain.setValueAtTime(isEqEnabled ? parseFloat(bassGain) : 0, audioContext.currentTime);
    trebleFilter.gain.setValueAtTime(isEqEnabled ? parseFloat(trebleGain) : 0, audioContext.currentTime);
    
    if (compressor) {
        compressor.threshold.setValueAtTime(parseFloat(compThreshold), audioContext.currentTime);
        compressor.ratio.setValueAtTime(parseFloat(compRatio), audioContext.currentTime);
    }
    
    if (panner) {
        panner.pan.setValueAtTime(parseFloat(panValue), audioContext.currentTime);
    }
    
    if (distortion) { 
        distortion.curve = makeDistortionCurve(isDistortionEnabled ? parseFloat(distortionAmount) : 0);
    }

    // Оновлення Time-based ефектів
    wetGainReverb.gain.setValueAtTime(isReverbEnabled ? parseFloat(reverbAmount) : 0, audioContext.currentTime);
    delay.delayTime.setValueAtTime(parseFloat(delayTime), audioContext.currentTime);
    delayFeedbackGain.gain.setValueAtTime(isDelayEnabled ? parseFloat(delayFeedback) : 0, audioContext.currentTime);
    wetGainDelay.gain.setValueAtTime(isDelayEnabled ? 1.0 : 0, audioContext.currentTime);

    if (flangerLFO && flangerLfoDepthGain) {
        flangerLFO.frequency.setValueAtTime(parseFloat(flangerRate), audioContext.currentTime);
        flangerLfoDepthGain.gain.setValueAtTime(isFlangerEnabled ? parseFloat(flangerDepth) : 0, audioContext.currentTime);
        wetGainFlanger.gain.setValueAtTime(isFlangerEnabled ? parseFloat(flangerMix) : 0, audioContext.currentTime);
    }

    // Оновлення Master Gain
    masterGainNode.gain.setValueAtTime(parseFloat(masterGain), audioContext.currentTime);
    
    // **ВАЖЛИВО:** Цей useEffect не викликає initLiveGraph, тому відтворення не зупиняється.
  }, [bassGain, trebleGain, hpfFreq, compThreshold, compRatio, panValue, distortionAmount, reverbAmount, delayTime, delayFeedback, flangerDepth, flangerRate, flangerMix, masterGain, audioContext, 
      isEqEnabled, isHpfEnabled, isCompressorEnabled, isPannerEnabled, isDistortionEnabled, isReverbEnabled, isDelayEnabled, isFlangerEnabled
  ]);

  // Функція для отримання всіх поточних параметрів стану
  const getCurrentStates = useCallback(() => ({
    isHpfEnabled, isEqEnabled, isDistortionEnabled, isCompressorEnabled, isPannerEnabled, 
    isReverbEnabled, isDelayEnabled, isFlangerEnabled, 
    bassGain, trebleGain, hpfFreq, compThreshold, compRatio, panValue, distortionAmount, 
    reverbAmount, delayTime, delayFeedback, flangerDepth, flangerRate, flangerMix, masterGain
  }), [isHpfEnabled, isEqEnabled, isDistortionEnabled, isCompressorEnabled, isPannerEnabled, 
      isReverbEnabled, isDelayEnabled, isFlangerEnabled, 
      bassGain, trebleGain, hpfFreq, compThreshold, compRatio, panValue, distortionAmount, 
      reverbAmount, delayTime, delayFeedback, flangerDepth, flangerRate, flangerMix, masterGain]);


  // Функція для ініціалізації графа для живого відтворення (зупиняє попередній)
  const initLiveGraph = useCallback(() => {
    if (!audioContext || !audioBuffer) return;
    
    if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch (e) { /* ignore */ }
        Object.values(nodesRef.current).forEach(node => {
            if (node && node.disconnect) {
                try { node.disconnect(); } catch (e) { /* ignore disconnect errors */ }
            }
        });
    }

    const initialStates = getCurrentStates();
    const newNodes = createAudioGraph(audioContext, audioBuffer, initialStates);
    sourceRef.current = newNodes.source;
    nodesRef.current = newNodes;
    
    sourceRef.current.onended = () => {
      stopPlayback(true);
    };
  }, [audioContext, audioBuffer, createAudioGraph, getCurrentStates]);

  // Ефект для dynamic routing (ON/OFF кнопок)
  useEffect(() => {
      if (audioBuffer) {
          // Якщо грає, зупиняємо, інакше просто ініціалізуємо граф
          if (isPlaying) {
            const currentOffset = currentPlaybackTime;
            stopPlayback(true);
            setCurrentPlaybackTime(currentOffset);
          }
          const timer = setTimeout(() => {
             initLiveGraph();
             // Якщо грало, продовжуємо з того ж місця після ініціалізації
             if (isPlaying) {
                 togglePlayback();
             }
          }, 50);
          return () => clearTimeout(timer);
      }
  // Залежність лише від булевих станів (routing)
  }, [isPannerEnabled, isCompressorEnabled, isHpfEnabled, isEqEnabled, isDistortionEnabled, isReverbEnabled, isDelayEnabled, isFlangerEnabled, audioBuffer]);


  // --- 4. Обробка Файлів та Часу ---
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file || !audioContext) return;

    resetState();
    setLoading(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      audioContext.decodeAudioData(e.target.result)
        .then(buffer => {
          setAudioBuffer(buffer);
          setStartTime(0);
          setEndTime(buffer.duration);
          setCurrentPlaybackTime(0); // Курсор на початку
          setLoading(false);
          setError('');
          // Ініціалізуємо граф з параметрами за замовчуванням
          const initialStates = getCurrentStates();
          const newNodes = createAudioGraph(audioContext, buffer, initialStates);
          nodesRef.current = newNodes; // Зберігаємо ноди для оновлення параметрів
          sourceRef.current = null; // Ноду відтворення створимо при Play
        })
        .catch(err => {
          console.error("Помилка декодування аудіо:", err);
          setError('Не вдалося декодувати аудіофайл. Спробуйте MP3, WAV або OGG.');
          setLoading(false);
        });
    };
    reader.onerror = () => {
      setError('Помилка читання файлу.');
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  };
  
  // stopPlayback тепер приймає аргумент для збереження позиції курсору
  const stopPlayback = useCallback((keepPosition = false) => {
      if (sourceRef.current) {
          try { 
            sourceRef.current.stop();
          } catch (e) {
            // Ігнорувати, якщо нода вже зупинена
          }
          sourceRef.current.disconnect();
          sourceRef.current = null;
      }
      setIsPlaying(false);
      // Якщо не зберігаємо позицію, повертаємо курсор на початок обрізання
      if (!keepPosition) {
        setCurrentPlaybackTime(startTime);
        playbackOffsetRef.current = startTime;
      }
  }, [startTime]);
  
  const togglePlayback = () => {
    if (!audioBuffer || !audioContext) {
      setError('Спочатку завантажте аудіофайл.');
      return;
    }

    if (isPlaying) {
      if (sourceRef.current) {
        // Зберігаємо поточний час для відновлення
        const elapsed = audioContext.currentTime - playbackStartTimeRef.current;
        const newOffset = playbackOffsetRef.current + elapsed;
        playbackOffsetRef.current = newOffset;
        setCurrentPlaybackTime(newOffset);
        
        try { 
            sourceRef.current.stop();
        } catch (e) { /* ignore */ }
        
        sourceRef.current.disconnect();
        sourceRef.current = null; 
      }
      setIsPlaying(false);
    } else {
      if (audioContext.state === 'suspended') audioContext.resume();
      
      // Якщо курсор вийшов за межі, повертаємо його на початок обрізання
      let startOffset = currentPlaybackTime;
      if (startOffset < startTime || startOffset >= endTime) {
         startOffset = startTime;
      }
      
      // Створюємо новий граф, якщо його немає
      if (!sourceRef.current) { 
          initLiveGraph();
      }

      const preFXGainParam = nodesRef.current.preFXGain?.gain;
      const duration = endTime - startOffset; // Довжина, яку потрібно відтворити
      
      // Автоматизація Fade In/Out для LIVE Playback (застосовуємо лише до початкової точки)
      if (preFXGainParam) {
          preFXGainParam.cancelAndHoldAtTime(audioContext.currentTime); 
          preFXGainParam.setValueAtTime(1, audioContext.currentTime);
          
          if (isFadeInEnabled && startOffset === startTime) {
              const fadeDuration = Math.min(fadeInDuration, duration);
              preFXGainParam.setValueAtTime(0, audioContext.currentTime);
              preFXGainParam.linearRampToValueAtTime(1, audioContext.currentTime + fadeDuration);
          }
          
          if (isFadeOutEnabled) {
              const fadeDuration = Math.min(fadeOutDuration, duration);
              const fadeStart = audioContext.currentTime + duration - fadeDuration;
              if (fadeStart > audioContext.currentTime) {
                  preFXGainParam.linearRampToValueAtTime(1, fadeStart);
                  preFXGainParam.linearRampToValueAtTime(0.0001, audioContext.currentTime + duration);
              }
          }
      }

      if (duration <= 0) {
        setError('Некоректні точки обрізання.');
        return;
      }
      
      // Встановлюємо нові референси для Playhead
      playbackOffsetRef.current = startOffset;
      playbackStartTimeRef.current = audioContext.currentTime;

      sourceRef.current.start(0, startOffset, duration);
      setIsPlaying(true);
      setError('');
    }
  };
  
  // Обробка обрізання (Числові поля)
  // Створимо допоміжну функцію, щоб уникнути дублювання
  const handleTimeInput = (setter, value, min, max) => {
    let num = parseFloat(value);
    if (isNaN(num)) return;
    if (num < min) num = min;
    if (num > max) num = max;

    if (setter === setStartTime) {
      if (num >= endTime && audioBuffer) num = endTime - 0.01;
      setter(num);
      setCurrentPlaybackTime(num);
    } else if (setter === setEndTime) {
      if (num <= startTime) num = startTime + 0.01;
      setter(num);
    }
  };
  
  // Ці функції-обгортки більше не потрібні, оскільки ми використовуємо handleTimeInput безпосередньо у JSX.
  // const handleStartTimeChange = (e) => {
  //     handleTimeInput(setStartTime, e.target.value, 0, totalDuration);
  // };
  //
  // const handleEndTimeChange = (e) => {
  //     handleTimeInput(setEndTime, e.target.value, 0, totalDuration);
  // };
  
  // --- Обробка взаємодії на Canvas ---

  const getClickTime = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickRatio = x / rect.width;
    const totalDuration = audioBuffer ? audioBuffer.duration : 0;
    return Math.max(0, Math.min(totalDuration, clickRatio * totalDuration));
  };
  
  const handleCanvasMouseDown = (e) => {
    if (!audioBuffer) return;
    const clickTime = getClickTime(e);
    const totalDuration = audioBuffer.duration;
    
    const startX = (startTime / totalDuration) * canvasDimensions.width;
    const endX = (endTime / totalDuration) * canvasDimensions.width;
    
    // Перевірка, чи клікнули на маркер обрізання
    if (Math.abs(e.clientX - canvasRef.current.getBoundingClientRect().left - startX) < 10) {
        isDraggingRef.current = 'start';
    } else if (Math.abs(e.clientX - canvasRef.current.getBoundingClientRect().left - endX) < 10) {
        isDraggingRef.current = 'end';
    } else {
        // Якщо не маркер, то це Seek/Scrub
        isDraggingRef.current = 'seek';
        stopPlayback(true); // Зупиняємо відтворення, але зберігаємо позицію
        setCurrentPlaybackTime(clickTime);
        playbackOffsetRef.current = clickTime;
    }
  };
  
  const handleCanvasMouseMove = (e) => {
    if (!audioBuffer || !isDraggingRef.current) return;
    const newTime = getClickTime(e);
    const totalDuration = audioBuffer.duration;

    if (isDraggingRef.current === 'seek') {
        setCurrentPlaybackTime(newTime);
        playbackOffsetRef.current = newTime;
    } else if (isDraggingRef.current === 'start') {
        // Захист від перетину (min value is 0)
        if (newTime >= 0 && newTime < endTime) {
            setStartTime(newTime);
            // Пересуваємо курсор разом із початком обрізання, якщо він лівіше
            if (currentPlaybackTime < newTime) {
                setCurrentPlaybackTime(newTime);
                playbackOffsetRef.current = newTime;
            }
        }
    } else if (isDraggingRef.current === 'end') {
        // Захист від перетину (max value is totalDuration)
        if (newTime > startTime && newTime <= totalDuration) {
            setEndTime(newTime);
            // Пересуваємо курсор разом із кінцем обрізання, якщо він правіше
            if (currentPlaybackTime > newTime) {
                setCurrentPlaybackTime(newTime);
                playbackOffsetRef.current = newTime;
            }
        }
    }
  };
  
  const handleCanvasMouseUp = () => {
    isDraggingRef.current = null;
  };


  // --- 5. Функція Завантаження (з Offline Rendering) ---
  const handleDownload = async () => {
    if (!audioBuffer) {
      setError('Спочатку завантажте та обріжте аудіофайл.');
      return;
    }
    if (endTime <= startTime) {
      setError('Кінець обрізання повинен бути пізнішим за початок.');
      return;
    }

    stopPlayback(true); 
    setLoading(true);
    setError('');

    try {
      const duration = endTime - startTime;
      const durationSamples = Math.floor(duration * audioBuffer.sampleRate);

      const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        durationSamples,
        audioBuffer.sampleRate
      );
      
      // Створюємо граф з усіма поточними станами
      const initialStates = getCurrentStates();
      const { source, preFXGain } = createAudioGraph(offlineContext, audioBuffer, initialStates);
      
      // Автоматизація Fade In/Out для OFFLINE Rendering
      const preFXGainParam = preFXGain.gain;
      preFXGainParam.setValueAtTime(1, 0); 

      if (isFadeInEnabled) {
          const fadeDuration = Math.min(fadeInDuration, duration);
          preFXGainParam.setValueAtTime(0.0001, 0); 
          preFXGainParam.linearRampToValueAtTime(1, offlineContext.currentTime + fadeDuration);
      }
      
      if (isFadeOutEnabled) {
          const fadeDuration = Math.min(fadeOutDuration, duration);
          const fadeStart = duration - fadeDuration;
          
          if (fadeStart > 0) {
              preFXGainParam.linearRampToValueAtTime(1, fadeStart);
          } else {
              preFXGainParam.setValueAtTime(1, offlineContext.currentTime + 0.0001); 
          }
          
          preFXGainParam.linearRampToValueAtTime(0.0001, offlineContext.currentTime + duration);
      }
      
      // Запускаємо відтворення в офлайн-контексті з потрібних точок
      source.start(0, startTime, duration); 

      // Рендеринг (обробка)
      const renderedBuffer = await offlineContext.startRendering();

      // Конвертація результату у WAV
      const wavBlob = audioBufferToWav(renderedBuffer);
      
      // Завантаження
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `NanoStudio_Processed_Audio_${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setLoading(false);

    } catch (e) {
      console.error('Помилка при рендерингу/завантаженні:', e);
      setError('Помилка при обробці та створенні файлу WAV. Перевірте консоль.');
      setLoading(false);
    }
  };


  // Форматування часу у хвилини:секунди
  const formatTime = (seconds) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    if (seconds === 0) return "00:00.00";
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${Math.floor((seconds % 1) * 100).toString().padStart(2, '0')}`;
  };

  const totalDuration = audioBuffer ? audioBuffer.duration : 0;
  const currentDuration = endTime - startTime;

  // Стилі для повзунків
  const sliderStyles = `
    .range-slider {
      -webkit-appearance: none;
      appearance: none;
      height: 6px;
      background: #4B5563; 
      border-radius: 4px;
      cursor: pointer;
      width: 100%;
    }
    .range-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #10B981; 
      cursor: pointer;
      box-shadow: 0 0 4px rgba(0,0,0,0.5);
    }
    .range-slider::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #10B981;
      cursor: pointer;
    }
    .toggle-button {
        padding: 4px 8px;
        font-size: 0.75rem;
        font-weight: 600;
        border-radius: 6px;
        transition: all 0.2s;
    }
    .toggle-on {
        background-color: #10B981; /* Green 500 */
        color: #111827; /* Gray 900 */
        box-shadow: 0 2px 4px rgba(16, 185, 129, 0.4);
    }
    .toggle-off {
        background-color: #4B5563; /* Gray 600 */
        color: #D1D5DB; /* Gray 300 */
    }
  `;

  const startPercent = (startTime / totalDuration) * 100 || 0;
  const endPercent = (endTime / totalDuration) * 100 || 0;
  
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-2 sm:p-4 md:p-8 font-inter">
      <style>{sliderStyles}</style>
      <div className="max-w-5xl mx-auto">
        {/* Хедер */}
        <header className="mb-4 p-3 bg-gray-800 rounded-xl shadow-2xl flex items-center justify-between">
            <div className="flex items-center space-x-2 sm:space-x-4">
                <h1 className="text-lg sm:text-xl font-bold text-blue-400 flex items-center">
                    <SlidersHorizontal className="mr-2 w-5 h-5" />
                    NanoStudio DAW v8 (Playhead & Dragging)
                </h1>
                <span className='text-xs text-gray-500 hidden sm:block'>Обробка аудіо в браузері</span>
            </div>
            {/* Кнопка Завантаження */}
            <label className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-3 sm:px-4 rounded-lg cursor-pointer transition duration-200 shadow-md text-sm">
                <FileUp className="w-4 h-4 mr-2" />
                Файл
                <input 
                    type="file" 
                    accept="audio/*" 
                    onChange={handleFileUpload} 
                    className="hidden" 
                    disabled={loading}
                />
            </label>
        </header>

        {/* Секція Візуального Редактора Хвильової Форми */}
        <section className="bg-gray-800 rounded-xl shadow-lg mb-4 sm:mb-6 overflow-hidden">
            <div className='flex items-center p-3 border-b border-gray-700 bg-gray-700'>
                <button className='flex items-center space-x-2 bg-blue-600 px-3 py-1 text-sm rounded-lg font-medium shadow-lg'>
                    <span className='text-xs'>✂️ Обрізка & Візуалізація</span>
                </button>
                <div className='ml-4 text-gray-400 text-xs truncate'>
                    {audioBuffer ? `Тривалість: ${formatTime(totalDuration)}` : 'Завантажте файл для редагування'}
                </div>
            </div>
            
            {/* Контейнер Хвильової Форми (Canvas) */}
            <div 
                ref={canvasWrapperRef}
                className="relative h-40 bg-gray-900 w-full" 
            >
                <canvas 
                    ref={canvasRef} 
                    className="w-full h-full cursor-pointer"
                    style={{ display: audioBuffer ? 'block' : 'none' }}
                    width={canvasDimensions.width} 
                    height={canvasDimensions.height}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseUp}
                />
                 {!audioBuffer && (
                    <div className="h-full w-full flex items-center justify-center text-gray-500 text-sm">
                        Waveform: Завантажте аудіофайл
                    </div>
                 )}
                 {/* Відображення поточного часу (курсора) */}
                 <div className='absolute top-2 left-3 bg-gray-800 p-1 text-xs rounded text-red-300 font-mono'>
                     {formatTime(currentPlaybackTime)}
                 </div>
            </div>
            {error && <p className="text-red-400 p-3 text-sm">{error}</p>}
            
            {/* Контролери Часу Обрізання (Числові поля) */}
            <div className='p-3 bg-gray-700 flex flex-col sm:flex-row items-center justify-between text-sm space-y-2 sm:space-y-0'>
                <div className='flex items-center space-x-2'>
                    <span className='text-gray-400'>Початок:</span>
                    <input 
                        type="number"
                        value={startTime.toFixed(2)}
                        onChange={(e) => handleTimeInput(setStartTime, e.target.value, 0, totalDuration)}
                        step="0.01"
                        min="0"
                        max={endTime}
                        className='bg-gray-800 text-cyan-300 p-1 w-20 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500'
                        disabled={!audioBuffer}
                    />
                </div>
                <div className='flex items-center space-x-2'>
                    <span className='text-gray-400'>Кінець:</span>
                     <input 
                        type="number"
                        value={endTime.toFixed(2)}
                        onChange={(e) => handleTimeInput(setEndTime, e.target.value, startTime, totalDuration)}
                        step="0.01"
                        min={startTime}
                        max={totalDuration}
                        className='bg-gray-800 text-cyan-300 p-1 w-20 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500'
                        disabled={!audioBuffer}
                    />
                </div>
            </div>
        </section>

        {/* Панель Управління */}
        <div className="flex items-center justify-between p-4 bg-gray-800 rounded-xl shadow-lg mb-4 sm:mb-6">
            <div className='flex items-center space-x-3'>
                {/* Кнопка Відтворення */}
                <button
                    onClick={togglePlayback}
                    className={`p-3 rounded-full transition duration-300 shadow-xl ${
                        isPlaying
                            ? 'bg-yellow-500 hover:bg-yellow-600 text-gray-900'
                            : 'bg-green-500 hover:bg-green-600 text-white'
                    }`}
                    disabled={!audioBuffer || loading}
                    aria-label={isPlaying ? 'Пауза' : 'Відтворити'}
                >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>
                 {/* Кнопка Зупинки */}
                <button
                    onClick={() => stopPlayback(false)}
                    className="p-3 rounded-full bg-red-500 hover:bg-red-600 text-white transition duration-300 shadow-xl"
                    disabled={!audioBuffer || loading}
                    aria-label="Зупинити та скинути"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Відображення Точок Обрізання */}
            <div className='hidden sm:flex items-center space-x-4 bg-gray-700 p-2 rounded-lg text-sm font-mono'>
                <span>Обрано:</span>
                <span className='text-blue-400'>{formatTime(currentDuration)}</span>
            </div>

            {/* Кнопка Зберегти (Завантажити) */}
            <button
                onClick={handleDownload}
                className="flex items-center bg-cyan-500 hover:bg-cyan-600 text-gray-900 font-bold py-2.5 px-4 sm:px-6 rounded-lg transition duration-200 shadow-md text-sm sm:text-base"
                disabled={!audioBuffer || loading || isPlaying}
            >
                {loading ? (
                <>
                    <Loader className="w-5 h-5 mr-2 animate-spin" />
                    Рендеринг...
                </>
                ) : (
                <>
                    <Download className="w-5 h-5 mr-2" />
                    Зберегти WAV
                </>
                )}
            </button>
        </div>
        
        {/* Секція Fade In/Out */}
        <section className="bg-gray-800 p-4 rounded-xl shadow-lg mb-4">
            <h3 className="text-lg font-semibold mb-3 text-cyan-300 flex items-center">
                <Speaker className='w-4 h-4 mr-2' />
                Автоматизація Гучності (Fade In/Out)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Fade In */}
                <div className="bg-gray-700 p-4 rounded-lg flex flex-col space-y-3">
                    <div className='flex justify-between items-center'>
                        <span className="text-sm font-medium text-white">Fade In (Початок)</span>
                        <button 
                            onClick={() => setIsFadeInEnabled(!isFadeInEnabled)}
                            className={`toggle-button ${isFadeInEnabled ? 'toggle-on' : 'toggle-off'}`}
                            disabled={!audioBuffer}
                        >
                            {isFadeInEnabled ? 'ON' : 'OFF'}
                        </button>
                    </div>
                    <label className='text-xs text-gray-400 mt-2'>Тривалість ({fadeInDuration.toFixed(2)} с)</label>
                    <input
                        type="range" min="0.1" max="5.0" step="0.1"
                        value={fadeInDuration}
                        onChange={(e) => setFadeInDuration(parseFloat(e.target.value))}
                        className="range-slider"
                        disabled={!audioBuffer || !isFadeInEnabled}
                    />
                </div>
                
                {/* Fade Out */}
                 <div className="bg-gray-700 p-4 rounded-lg flex flex-col space-y-3">
                    <div className='flex justify-between items-center'>
                        <span className="text-sm font-medium text-white">Fade Out (Кінець)</span>
                        <button 
                            onClick={() => setIsFadeOutEnabled(!isFadeOutEnabled)}
                            className={`toggle-button ${isFadeOutEnabled ? 'toggle-on' : 'toggle-off'}`}
                            disabled={!audioBuffer}
                        >
                            {isFadeOutEnabled ? 'ON' : 'OFF'}
                        </button>
                    </div>
                    <label className='text-xs text-gray-400 mt-2'>Тривалість ({fadeOutDuration.toFixed(2)} с)</label>
                    <input
                        type="range" min="0.1" max="5.0" step="0.1"
                        value={fadeOutDuration}
                        onChange={(e) => setFadeOutDuration(parseFloat(e.target.value))}
                        className="range-slider"
                        disabled={!audioBuffer || !isFadeOutEnabled}
                    />
                </div>
            </div>
        </section>


        {/* Секція Мікшера Master Channel */}
        <section className="bg-gray-800 p-4 sm:p-6 rounded-xl shadow-lg">
          <h2 className="text-xl font-semibold mb-5 text-gray-200 flex items-center">
            <SlidersHorizontal className='mr-3 w-5 h-5' />
            Master Mixer Channel (Еквалізація та Ефекти)
          </h2>
          
          {/* Адаптивна сітка */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            
            {/* 1. Master Volume */}
            <div className="bg-gray-700 p-4 rounded-lg flex flex-col justify-between">
              <label htmlFor="masterGain" className="block text-sm font-medium text-white mb-2 flex items-center">
                <Volume2 className='w-4 h-4 mr-1 text-red-400' />
                Гучність (Master)
              </label>
              <input
                type="range"
                id="masterGain"
                className="range-slider"
                min="0"
                max="2"
                step="0.05"
                value={masterGain}
                onChange={(e) => setMasterGain(parseFloat(e.target.value))}
                disabled={!audioBuffer}
              />
              <span className={`w-full text-center font-mono text-sm mt-2 rounded-md ${masterGain > 1.0 ? 'text-red-300' : 'text-green-300'}`}>
                {masterGain.toFixed(2)}x
              </span>
            </div>

            {/* 2. Еквалайзер (Група) */}
            <div className="bg-gray-700 p-4 rounded-lg flex flex-col space-y-3">
                <div className='flex justify-between items-center'>
                    <span className="text-sm font-medium text-blue-300">EQ (Bass/Treble)</span>
                    <button 
                        onClick={() => setIsEqEnabled(!isEqEnabled)}
                        className={`toggle-button ${isEqEnabled ? 'toggle-on' : 'toggle-off'}`}
                        disabled={!audioBuffer}
                    >
                        {isEqEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
                
                <label className='text-xs text-gray-400 mt-2'>Бас (120 Гц, {bassGain.toFixed(1)} dB)</label>
                <input
                    type="range" min="-15" max="15" step="0.1"
                    value={bassGain}
                    onChange={(e) => setBassGain(parseFloat(e.target.value))}
                    className="range-slider"
                    disabled={!audioBuffer || !isEqEnabled}
                />
                <label className='text-xs text-gray-400'>Високі (8 кГц, {trebleGain.toFixed(1)} dB)</label>
                <input
                    type="range" min="-15" max="15" step="0.1"
                    value={trebleGain}
                    onChange={(e) => setTrebleGain(parseFloat(e.target.value))}
                    className="range-slider"
                    disabled={!audioBuffer || !isEqEnabled}
                />
            </div>
            
            {/* 3. HPF Фільтр */}
             <div className="bg-gray-700 p-4 rounded-lg flex flex-col space-y-4">
                <div className='flex justify-between items-center'>
                    <span className="text-sm font-medium text-yellow-300 flex items-center"><Minus className='w-4 h-4 mr-1' /> HPF Cut</span>
                    <button 
                        onClick={() => setIsHpfEnabled(!isHpfEnabled)}
                        className={`toggle-button ${isHpfEnabled ? 'toggle-on' : 'toggle-off'}`}
                        disabled={!audioBuffer}
                    >
                        {isHpfEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
                
                <label className='text-xs text-gray-400 mt-2'>Частота зрізу</label>
                <input
                    type="range" min="20" max="300" step="5"
                    value={hpfFreq}
                    onChange={(e) => setHpfFreq(parseFloat(e.target.value))}
                    className="range-slider"
                    disabled={!audioBuffer || !isHpfEnabled}
                />
                <span className='w-full text-center font-mono text-sm text-yellow-300'>{hpfFreq.toFixed(0)} Hz</span>
            </div>

            {/* 4. Distortion/Saturation (Нова функція) */}
            <div className="bg-gray-700 p-4 rounded-lg flex flex-col space-y-4">
                <div className='flex justify-between items-center'>
                    <span className="text-sm font-medium text-orange-400 flex items-center"><Zap className='w-4 h-4 mr-1' /> Distortion</span>
                    <button 
                        onClick={() => setIsDistortionEnabled(!isDistortionEnabled)}
                        className={`toggle-button ${isDistortionEnabled ? 'toggle-on' : 'toggle-off'}`}
                        disabled={!audioBuffer}
                    >
                        {isDistortionEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
                
                <label className='text-xs text-gray-400 mt-2'>Amount (0-100)</label>
                <input
                    type="range" min="0" max="100" step="1"
                    value={distortionAmount}
                    onChange={(e) => setDistortionAmount(parseFloat(e.target.value))}
                    className="range-slider"
                    disabled={!audioBuffer || !isDistortionEnabled}
                />
                <span className='w-full text-center font-mono text-sm text-orange-400'>{distortionAmount.toFixed(0)}</span>
            </div>
            
            {/* 5. Compressor (Компресор) */}
            <div className="bg-gray-700 p-4 rounded-lg flex flex-col space-y-3">
                <div className='flex justify-between items-center'>
                    <span className="text-sm font-medium text-red-300 flex items-center"><Zap className='w-4 h-4 mr-1' /> Compressor</span>
                    <button 
                        onClick={() => setIsCompressorEnabled(!isCompressorEnabled)}
                        className={`toggle-button ${isCompressorEnabled ? 'toggle-on' : 'toggle-off'}`}
                        disabled={!audioBuffer}
                    >
                        {isCompressorEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
                
                <label className='text-xs text-gray-400 mt-2'>Threshold ({compThreshold.toFixed(0)} dB)</label>
                <input
                    type="range" min="-60" max="0" step="1"
                    value={compThreshold}
                    onChange={(e) => setCompThreshold(parseFloat(e.target.value))}
                    className="range-slider"
                    disabled={!audioBuffer || !isCompressorEnabled}
                />
                <label className='text-xs text-gray-400'>Ratio ({compRatio.toFixed(1)}:1)</label>
                <input
                    type="range" min="1" max="20" step="0.5"
                    value={compRatio}
                    onChange={(e) => setCompRatio(parseFloat(e.target.value))}
                    className="range-slider"
                    disabled={!audioBuffer || !isCompressorEnabled}
                />
            </div>

            {/* 6. Stereo Panner */}
            <div className="bg-gray-700 p-4 rounded-lg flex flex-col space-y-4">
                <div className='flex justify-between items-center'>
                    <span className="text-sm font-medium text-teal-300 flex items-center"><Split className='w-4 h-4 mr-1' /> Panner</span>
                    <button 
                        onClick={() => setIsPannerEnabled(!isPannerEnabled)}
                        className={`toggle-button ${isPannerEnabled ? 'toggle-on' : 'toggle-off'}`}
                        disabled={!audioBuffer}
                    >
                        {isPannerEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
                
                <label className='text-xs text-gray-400 mt-2'>Панорама</label>
                <input
                    type="range" min="-1" max="1" step="0.05"
                    value={panValue}
                    onChange={(e) => setPanValue(parseFloat(e.target.value))}
                    className="range-slider"
                    disabled={!audioBuffer || !isPannerEnabled}
                />
                <span className={`w-full text-center font-mono text-sm text-teal-300`}>
                    {panValue < 0 ? `L: ${Math.abs(panValue).toFixed(2)}` : panValue > 0 ? `R: ${panValue.toFixed(2)}` : 'Center'}
                </span>
            </div>

            {/* 7. Реверберація (Reverb) */}
             <div className="bg-gray-700 p-4 rounded-lg flex flex-col space-y-3">
                <div className='flex justify-between items-center'>
                    <span className="text-sm font-medium text-purple-300 flex items-center"><Waves className='w-4 h-4 mr-1' /> Реверб (Mix)</span>
                    <button 
                        onClick={() => setIsReverbEnabled(!isReverbEnabled)}
                        className={`toggle-button ${isReverbEnabled ? 'toggle-on' : 'toggle-off'}`}
                        disabled={!audioBuffer}
                    >
                        {isReverbEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
              <label className='text-xs text-gray-400 mt-2'>Wet Level</label>
              <input
                type="range" min="0" max="1" step="0.05"
                value={reverbAmount}
                onChange={(e) => setReverbAmount(parseFloat(e.target.value))}
                className="range-slider"
                disabled={!audioBuffer || !isReverbEnabled}
              />
              <span className={`w-full text-center font-mono text-sm mt-2 rounded-md ${reverbAmount > 0.5 ? 'text-purple-300' : 'text-gray-300'}`}>
                {(reverbAmount * 100).toFixed(0)}%
              </span>
            </div>

            {/* 8. Delay (Ехо) */}
            <div className="bg-gray-700 p-4 rounded-lg flex flex-col space-y-3">
                <div className='flex justify-between items-center'>
                    <span className="text-sm font-medium text-orange-300 flex items-center"><Repeat className='w-4 h-4 mr-1' /> Delay</span>
                    <button 
                        onClick={() => setIsDelayEnabled(!isDelayEnabled)}
                        className={`toggle-button ${isDelayEnabled ? 'toggle-on' : 'toggle-off'}`}
                        disabled={!audioBuffer}
                    >
                        {isDelayEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
                
                <label className='text-xs text-gray-400 mt-2'>Час ({delayTime.toFixed(2)} с)</label>
                <input
                    type="range" min="0.1" max="1.0" step="0.05"
                    value={delayTime}
                    onChange={(e) => setDelayTime(parseFloat(e.target.value))}
                    className="range-slider"
                    disabled={!audioBuffer || !isDelayEnabled}
                />
                <label className='text-xs text-gray-400'>Feedback ({delayFeedback.toFixed(2)})</label>
                <input
                    type="range" min="0.0" max="0.8" step="0.05"
                    value={delayFeedback}
                    onChange={(e) => setDelayFeedback(parseFloat(e.target.value))}
                    className="range-slider"
                    disabled={!audioBuffer || !isDelayEnabled}
                />
            </div>

          </div>
        </section>
        
        <footer className="mt-4 text-center text-gray-500 text-sm">
            <p>
                **Зверніть увагу:** Веб-додаток **повністю адаптивний**. Кнопка **"Зберегти WAV"** застосовує **всі увімкнені** ефекти: EQ, HPF, Distortion, Compressor, Panner, Reverb, Delay, Flanger, а також **Fade In/Out**.
            </p>
        </footer>
      </div>
    </div>
  );
};

export default App;
