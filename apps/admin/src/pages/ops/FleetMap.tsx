import React, { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { ref as dbRef, onValue, off } from 'firebase/database';
import { database } from '../../lib/firebase';
import { Map, AlertCircle, Navigation } from 'lucide-react';
import { useActiveTrips } from '../../hooks/useActiveTrips';

// Keep reference to markers and animation frames outside React state
// to prevent hydration storms when 100+ buses ping their locations.
const markerMap = new globalThis.Map<string, google.maps.Marker>();
const targetPositions = new globalThis.Map<string, { lat: number, lng: number }>();
let animationFrameId: number;

export const FleetMap: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const { data: activeTrips = [], isLoading } = useActiveTrips();
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  // 1. Initialize Google Map
  useEffect(() => {
    if (!mapRef.current) return;

    setMapError(null);
    setOptions({
      key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
      v: 'weekly',
    });

    void importLibrary('maps').then(() => {
      const map = new google.maps.Map(mapRef.current!, {
        center: { lat: 13.0827, lng: 80.2707 }, // Default: Chennai
        zoom: 12,
        mapId: 'FLEET_MAP_DARK', // Custom styling
        disableDefaultUI: true,
        zoomControl: true,
        backgroundColor: '#111827',
      });
      setMapInstance(map);
    }).catch((e: unknown) => {
      console.error('Error loading Google Maps', e);
      setMapError('Unable to load Google Maps. Check configuration and network access.');
    });
  }, []);

  // 2. Linear Interpolation for Smooth Marker Movement
  const animateMapMarkers = () => {
    let moved = false;
    markerMap.forEach((marker: google.maps.Marker, busId: string) => {
      const target = targetPositions.get(busId);
      if (!target) return;

      const currentPos = marker.getPosition();
      if (!currentPos) {
        marker.setPosition(target);
        return;
      }

      // Simple Lerp (Linear Interpolation)
      const latDiff = target.lat - currentPos.lat();
      const lngDiff = target.lng - currentPos.lng();

      if (Math.abs(latDiff) > 0.00001 || Math.abs(lngDiff) > 0.00001) {
        moved = true;
        marker.setPosition({
          lat: currentPos.lat() + latDiff * 0.1, // 10% movement per frame
          lng: currentPos.lng() + lngDiff * 0.1
        });
      }
    });

    if (moved) {
      animationFrameId = requestAnimationFrame(animateMapMarkers);
    }
  };

  // 3. Bind Firebase Listeners per Active Trip
  useEffect(() => {
    if (!mapInstance || activeTrips.length === 0) return;

    activeTrips.forEach((trip) => {
      if (!trip.busId) return;

      // Create marker if doesn't exist
      if (!markerMap.has(trip.busId)) {
        const marker = new google.maps.Marker({
          map: mapInstance,
          title: `Bus ${trip.busNumber}`,
          label: {
            text: trip.busNumber,
            color: 'white'
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: trip.gpsStatus === 'LIVE' ? '#34D399' : (trip.gpsStatus === 'STALE' ? '#FBBF24' : '#EF4444'),
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          }
        });

        marker.addListener('click', () => {
          setSelectedBusId(trip.busId);
          mapInstance.panTo(marker.getPosition()!);
          mapInstance.setZoom(16);
        });

        markerMap.set(trip.busId, marker);
      }

      // Subscribe to Firebase Live Node
      const locRef = dbRef(database, `locations/${trip.busId}`);
      onValue(locRef, (snap) => {
        const data = snap.val();
        if (data && data.lat && data.lng) {
           targetPositions.set(trip.busId, { lat: data.lat, lng: data.lng });
           
           // Trigger Animation Frame
           cancelAnimationFrame(animationFrameId);
           animationFrameId = requestAnimationFrame(animateMapMarkers);
        }
      });
    });

    // Cleanup stale markers/listeners
    const activeBusIds = new Set(activeTrips.map(t => t.busId));
    markerMap.forEach((marker: google.maps.Marker, busId: string) => {
      if (!activeBusIds.has(busId)) {
        marker.setMap(null); // Remove from map
        markerMap.delete(busId);
        targetPositions.delete(busId);
        off(dbRef(database, `locations/${busId}`));
      }
    });

    return () => {
      activeTrips.forEach(t => {
        if (t.busId) off(dbRef(database, `locations/${t.busId}`));
      });
      cancelAnimationFrame(animationFrameId);
    };
  }, [mapInstance, activeTrips]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      
      {/* Top Banner */}
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>Global Fleet Map</h1>
          <p style={{ margin: 0, color: '#9CA3AF' }}>Tracking {activeTrips.length} active buses via Firebase RTDB.</p>
        </div>
        {selectedBusId && (
          <button 
            onClick={() => {
              setSelectedBusId(null);
              mapInstance?.setZoom(12);
              mapInstance?.panTo({ lat: 13.0827, lng: 80.2707 });
            }}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#374151',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center'
            }}
          >
            <Map size={16} /> Reset View
          </button>
        )}
      </div>

      {/* Map Container */}
      <div style={{ 
          flex: 1, 
          position: 'relative', 
          backgroundColor: '#1F2937', 
          borderRadius: '0.75rem', 
          overflow: 'hidden',
          border: '1px solid #374151'
        }}>
        
        {isLoading && !mapInstance && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', zIndex: 10 }}>
            Initializing Map Engine...
          </div>
        )}

        {mapError && (
          <div
            style={{
              position: 'absolute',
              top: '1rem',
              left: '1rem',
              right: '1rem',
              zIndex: 11,
              padding: '0.9rem 1rem',
              borderRadius: '0.75rem',
              background: 'rgba(127, 29, 29, 0.92)',
              border: '1px solid rgba(248, 113, 113, 0.35)',
              color: '#FCA5A5',
            }}
          >
            {mapError}
          </div>
        )}

        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

        {/* Selected Bus Floating Card Overlay */}
        {selectedBusId && (
          <div style={{
            position: 'absolute',
            bottom: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(17, 24, 39, 0.95)',
            backdropFilter: 'blur(8px)',
            padding: '1.25rem',
            borderRadius: '0.75rem',
            border: '1px solid #374151',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            minWidth: '300px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            {activeTrips.find(t => t.busId === selectedBusId)?.gpsStatus === 'LIVE' 
              ? <Navigation size={24} color="#34D399" />
              : <AlertCircle size={24} color="#EF4444" />}
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '1.125rem' }}>
                Bus {activeTrips.find(t => t.busId === selectedBusId)?.busNumber}
              </div>
              <div style={{ fontSize: '0.875rem', color: '#9CA3AF' }}>
                {activeTrips.find(t => t.busId === selectedBusId)?.routeName}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontWeight: '600' }}>
                {activeTrips.find(t => t.busId === selectedBusId)?.boardedCount} / {activeTrips.find(t => t.busId === selectedBusId)?.expectedCount}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Boarded</div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
