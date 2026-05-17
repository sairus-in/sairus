import React, { useEffect, useMemo, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { ref as dbRef, off, onValue } from 'firebase/database';
import { database } from '../../lib/firebase';
import { KPIBlock, SectionCard, StateBadge } from '../../components/design/primitives';
import { Icon } from '../../components/design/Icon';
import { useActiveTrips } from '../../hooks/useActiveTrips';

const markerMap = new globalThis.Map<string, google.maps.Marker>();
const targetPositions = new globalThis.Map<string, { lat: number; lng: number }>();
let animationFrameId: number;

const mapStyles: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f3f1eb' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6c6a63' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f3f1eb' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#dedad0' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#ebe8de' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#ece8dd' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dde3df' }] },
];

const statusColor = (gpsStatus?: string) => {
  if (gpsStatus === 'LIVE') return '#3a7a5a';
  if (gpsStatus === 'STALE') return '#a87437';
  return '#a6423a';
};

const resetCenter = { lat: 13.0827, lng: 80.2707 };

export const FleetMap: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const { data: activeTrips = [], isLoading } = useActiveTrips();
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    setMapError(null);
    setOptions({
      key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
      v: 'weekly',
    });

    void importLibrary('maps').then(() => {
      const map = new google.maps.Map(mapRef.current!, {
        center: resetCenter,
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
        backgroundColor: '#f3f1eb',
        styles: mapStyles,
      });
      setMapInstance(map);
    }).catch((e: unknown) => {
      console.error('Error loading Google Maps', e);
      setMapError('Unable to load Google Maps. Check configuration and network access.');
    });
  }, []);

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

      const latDiff = target.lat - currentPos.lat();
      const lngDiff = target.lng - currentPos.lng();

      if (Math.abs(latDiff) > 0.00001 || Math.abs(lngDiff) > 0.00001) {
        moved = true;
        marker.setPosition({
          lat: currentPos.lat() + latDiff * 0.1,
          lng: currentPos.lng() + lngDiff * 0.1,
        });
      }
    });

    if (moved) {
      animationFrameId = requestAnimationFrame(animateMapMarkers);
    }
  };

  useEffect(() => {
    if (!mapInstance || activeTrips.length === 0) return;

    activeTrips.forEach((trip) => {
      if (!trip.busId) return;

      if (!markerMap.has(trip.busId)) {
        const marker = new google.maps.Marker({
          map: mapInstance,
          title: `Bus ${trip.busNumber}`,
          label: {
            text: trip.busNumber,
            color: 'white',
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: statusColor(trip.gpsStatus),
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        });

        marker.addListener('click', () => {
          setSelectedBusId(trip.busId);
          mapInstance.panTo(marker.getPosition()!);
          mapInstance.setZoom(16);
        });

        markerMap.set(trip.busId, marker);
      }

      const locRef = dbRef(database, `buses/${trip.busId}`);
      onValue(locRef, (snap) => {
        const data = snap.val();
        if (data && typeof data.lat === 'number' && typeof data.lon === 'number') {
          targetPositions.set(trip.busId, { lat: data.lat, lng: data.lon });
          cancelAnimationFrame(animationFrameId);
          animationFrameId = requestAnimationFrame(animateMapMarkers);
        }
      });
    });

    const activeBusIds = new Set(activeTrips.map((trip) => trip.busId));
    markerMap.forEach((marker: google.maps.Marker, busId: string) => {
      if (!activeBusIds.has(busId)) {
        marker.setMap(null);
        markerMap.delete(busId);
        targetPositions.delete(busId);
        off(dbRef(database, `buses/${busId}`));
      }
    });

    return () => {
      activeTrips.forEach((trip) => {
        if (trip.busId) off(dbRef(database, `buses/${trip.busId}`));
      });
      cancelAnimationFrame(animationFrameId);
    };
  }, [mapInstance, activeTrips]);

  const selectedTrip = useMemo(
    () => activeTrips.find((trip) => trip.busId === selectedBusId) ?? activeTrips[0] ?? null,
    [activeTrips, selectedBusId],
  );

  useEffect(() => {
    if (!selectedBusId && activeTrips[0]?.busId) {
      setSelectedBusId(activeTrips[0].busId);
    }
  }, [activeTrips, selectedBusId]);

  const liveCount = activeTrips.filter((trip) => trip.gpsStatus === 'LIVE').length;
  const staleCount = activeTrips.filter((trip) => trip.gpsStatus === 'STALE').length;
  const offlineCount = activeTrips.filter((trip) => trip.gpsStatus !== 'LIVE' && trip.gpsStatus !== 'STALE').length;
  const boardedTotal = activeTrips.reduce((sum, trip) => sum + (trip.boardedCount ?? 0), 0);

  return (
    <div style={{ display: 'grid', gap: 16, minHeight: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          alignItems: 'flex-start',
          padding: 20,
          border: '1px solid var(--border)',
          borderRadius: 20,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(245,245,242,0.9))',
        }}
      >
        <div>
          <div className="mono" style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            Live Ops
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>
            Fleet Map
          </h1>
          <div style={{ marginTop: 6, color: 'var(--muted)', maxWidth: 760 }}>
            Live bus positions stream from the GPS pipeline. Click a card or marker to focus a vehicle.
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setSelectedBusId(null);
            mapInstance?.setZoom(12);
            mapInstance?.panTo(resetCenter);
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', padding: '10px 16px', fontWeight: 500 }}
        >
          <Icon name="refresh" size={12} />
          Reset View
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <KPIBlock label="Active Buses" value={activeTrips.length} sub="Trips reporting into the live map" spark={[2, 3, 4, 4, Math.max(activeTrips.length, 1)]} />
        <KPIBlock label="GPS Live" value={liveCount} sub="Healthy telemetry feed" accent="var(--ok)" spark={[1, 2, 3, 3, Math.max(liveCount, 1)]} />
        <KPIBlock label="Stale / Offline" value={`${staleCount + offlineCount}`} sub={`${staleCount} stale - ${offlineCount} offline`} accent="var(--warn)" spark={[1, 1, 2, 2, Math.max(staleCount + offlineCount, 1)]} />
        <KPIBlock label="Boarded" value={boardedTotal} sub="Total riders currently on tracked trips" accent="var(--info)" spark={[30, 45, 48, 52, Math.max(boardedTotal, 1)]} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 320px', gap: 16, minHeight: 0 }}>
        <SectionCard title="Fleet Feed" subtitle={isLoading ? 'Loading active trips' : `${activeTrips.length} active vehicles`}>
          <div className="scroll" style={{ display: 'grid', gap: 8, maxHeight: 'calc(100vh - 400px)', paddingRight: 4 }}>
            {isLoading ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading active buses...</div>
            ) : activeTrips.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)' }}>No active trips on the live map.</div>
            ) : (
              activeTrips.map((trip) => {
                const active = trip.busId === selectedTrip?.busId;
                return (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => {
                      if (!trip.busId) return;
                      setSelectedBusId(trip.busId);
                      const marker = markerMap.get(trip.busId);
                      const position = marker?.getPosition();
                      if (position && mapInstance) {
                        mapInstance.panTo(position);
                        mapInstance.setZoom(16);
                      }
                    }}
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      border: `1px solid ${active ? 'var(--ink)' : 'var(--border)'}`,
                      background: active ? 'var(--surface-2)' : 'var(--surface)',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                      <div className="mono" style={{ fontWeight: 500 }}>{trip.busNumber}</div>
                      <StateBadge state={trip.gpsStatus || 'OFFLINE'} label={trip.gpsStatus || 'Offline'} />
                    </div>
                    <div style={{ fontWeight: 500 }}>{trip.routeName}</div>
                    <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12 }}>
                      {trip.boardedCount} / {trip.expectedCount} riders boarded
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </SectionCard>

        <div style={{ display: 'grid', gap: 16 }}>
          <div
            style={{
              position: 'relative',
              border: '1px solid var(--border)',
              borderRadius: 20,
              overflow: 'hidden',
              background: '#f3f1eb',
              minHeight: 'calc(100vh - 400px)',
            }}
          >
            {mapError ? (
              <div style={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 5, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
                {mapError}
              </div>
            ) : null}

            <div
              style={{
                position: 'absolute',
                top: 16,
                left: 16,
                zIndex: 5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.94)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>LIVE FEED</span>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', animation: 'fleetops-pulse 1.6s var(--ease-out) infinite' }} />
            </div>

            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>

        <SectionCard title={selectedTrip ? `Bus ${selectedTrip.busNumber}` : 'Live Detail'} subtitle={selectedTrip ? selectedTrip.routeName : 'Select a bus from the fleet feed'}>
          {selectedTrip ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>TRIP SNAPSHOT</div>
                <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">GPS Status</span><StateBadge state={selectedTrip.gpsStatus || 'OFFLINE'} label={selectedTrip.gpsStatus || 'Offline'} /></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Boarded</span><span className="mono">{selectedTrip.boardedCount} / {selectedTrip.expectedCount}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Trip</span><span className="mono">{selectedTrip.id.slice(0, 8)}</span></div>
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>STATUS LEGEND</div>
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {[
                    ['Live GPS', '#3a7a5a'],
                    ['Stale GPS', '#a87437'],
                    ['Offline', '#a6423a'],
                  ].map(([label, color]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--muted)' }}>Select a live trip to inspect vehicle status and ridership.</div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};

export default FleetMap;
