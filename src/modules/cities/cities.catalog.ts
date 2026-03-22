export type SeedCityPoint = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  point_type: 'station' | 'airport' | 'university' | 'mall' | 'downtown' | 'custom';
  popularity_score: number;
  usage_count: number;
};

export type SeedCity = {
  name: string;
  province: string | null;
  country: string;
  points: SeedCityPoint[];
};

export const DEFAULT_CITY_CATALOG: SeedCity[] = [
  {
    name: 'Montreal',
    province: 'QC',
    country: 'Canada',
    points: [
      { name: 'Gare centrale', address: '895 Rue de la Gauchetiere O, Montreal, QC H3B 4G1', lat: 45.4995, lng: -73.5665, point_type: 'station', popularity_score: 95, usage_count: 12 },
      { name: 'Aeroport Montreal-Trudeau', address: '975 Romeo-Vachon Blvd N, Dorval, QC H4Y 1H1', lat: 45.4577, lng: -73.7499, point_type: 'airport', popularity_score: 90, usage_count: 10 },
      { name: 'Station Berri-UQAM', address: '505 Rue Sainte-Catherine E, Montreal, QC H2L 2C9', lat: 45.5151, lng: -73.5611, point_type: 'station', popularity_score: 86, usage_count: 9 },
      { name: 'Universite de Montreal', address: '2900 Edouard-Montpetit Blvd, Montreal, QC H3T 1J4', lat: 45.5048, lng: -73.6157, point_type: 'university', popularity_score: 72, usage_count: 7 },
    ],
  },
  {
    name: 'Quebec',
    province: 'QC',
    country: 'Canada',
    points: [
      { name: 'Universite Laval', address: '2325 Rue de l Universite, Quebec, QC G1V 0A6', lat: 46.7819, lng: -71.2744, point_type: 'university', popularity_score: 92, usage_count: 11 },
      { name: 'Gare du Palais', address: '450 Rue de la Gare-du-Palais, Quebec, QC G1K 3X2', lat: 46.8162, lng: -71.2176, point_type: 'station', popularity_score: 80, usage_count: 8 },
      { name: 'Centre-ville Quebec', address: '44 Cote du Palais, Quebec, QC G1R 4H8', lat: 46.8139, lng: -71.2082, point_type: 'downtown', popularity_score: 68, usage_count: 6 },
    ],
  },
  {
    name: 'Ottawa',
    province: 'ON',
    country: 'Canada',
    points: [
      { name: 'Universite d Ottawa', address: '75 Laurier Ave E, Ottawa, ON K1N 6N5', lat: 45.4231, lng: -75.6831, point_type: 'university', popularity_score: 82, usage_count: 8 },
      { name: 'Gare d Ottawa', address: '200 Tremblay Rd, Ottawa, ON K1G 3H5', lat: 45.4166, lng: -75.6511, point_type: 'station', popularity_score: 78, usage_count: 7 },
      { name: 'Centre Rideau', address: '50 Rideau St, Ottawa, ON K1N 9J7', lat: 45.4252, lng: -75.6925, point_type: 'mall', popularity_score: 62, usage_count: 5 },
    ],
  },
  {
    name: 'Toronto',
    province: 'ON',
    country: 'Canada',
    points: [
      { name: 'Union Station', address: '65 Front St W, Toronto, ON M5J 1E6', lat: 43.6452, lng: -79.3806, point_type: 'station', popularity_score: 96, usage_count: 13 },
      { name: 'Pearson Airport', address: '6301 Silver Dart Dr, Mississauga, ON L5P 1B2', lat: 43.6777, lng: -79.6248, point_type: 'airport', popularity_score: 94, usage_count: 11 },
      { name: 'Downtown Toronto', address: '100 Queen St W, Toronto, ON M5H 2N2', lat: 43.6535, lng: -79.3841, point_type: 'downtown', popularity_score: 73, usage_count: 7 },
    ],
  },
  {
    name: 'Sherbrooke',
    province: 'QC',
    country: 'Canada',
    points: [
      { name: 'Universite de Sherbrooke', address: '2500 Blvd de l Universite, Sherbrooke, QC J1K 2R1', lat: 45.3781, lng: -71.9281, point_type: 'university', popularity_score: 75, usage_count: 6 },
      { name: 'Centre-ville Sherbrooke', address: '455 Rue du Palais, Sherbrooke, QC J1H 6J9', lat: 45.4042, lng: -71.8929, point_type: 'downtown', popularity_score: 58, usage_count: 4 },
    ],
  },
];
