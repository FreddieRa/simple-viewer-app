import numpy as np
import pandas as pd
from convertbng.util import convert_bng

def split_coor(frame, col, delim=' '):
    """
    split the coordinate in form of <x y>. Type is string
    """
    return frame[col].str.split(delim, expand=True)

def clean_coordinates(frame, mode='link'):
    """
    split from and to coordinates
    """
    if mode == 'link':
        frame[['fromX', 'fromY']] = split_coor(frame, 'from')
        frame[['toX', 'toY']] = split_coor(frame, 'to')
        frame.drop(['from', 'to'], axis=1, inplace=True)

    if mode == 'node':
        # frame[['X', 'Y']] = split_coor(frame, 'location').astype(float)
        frame[['X', 'Y']] = frame[['xcoord', 'ycoord']]
        # frame.drop('location', axis=1, inplace=True)
    return frame

def convert_dtypes(frame, col_list):
    """
    Convert column data types to float
    """
    frame[col_list] = frame[col_list].astype(float)
    return frame

def impute_depth(frame):
    """
    Impute missing depth data
    """

    # Fill depth of up and down stream nodes with review depth data
    # According to Clive -mentor, this is actual measurement so reliable
    for col in ['UpDepth', 'DownDepth']:
        frame[col] = frame[col]\
                        .fillna(frame['ReviewDept'])

    # Invert Dept is chamber depth. When there's no information,
    # assume that pipes are plugged in to the middle of the chamber
    # which is worst case scenario, because it makes pipes closer to the
    # ground, and pipes are usually plugged to the bottom of the chamber

    frame['UpDepth'] = frame['UpDepth'].fillna(frame['InvertDept_up']/2)
    frame['DownDepth'] = frame['DownDepth'].fillna(frame['InvertDept_down']/2)

    # When all things fail, assume that the depth of the up and down
    # node to be the same.

    frame['UpDepth'] = frame['UpDepth'].fillna(frame['DownDepth'])
    frame['DownDepth'] = frame['DownDepth'].fillna(frame['UpDepth'])

    # Drop records with absolutely no information on Depth
    frame = frame.dropna(subset = ['UpDepth', 'DownDepth'], how='all')

    # Drop unused columns
    frame = frame.drop(['InvertDept_up', 'InvertDept_down'], axis=1)

    return frame

def impute_height(frame):
    """
    Imputing pipe height, which is measurement from top to bottom
    also means diametre
    """

    # Impute height with diametre
    frame['Height'] = frame['Height'].fillna(frame['ReviewDiam'])

    # Calculate average height by material and pipe usage
    mat = frame\
            .groupby(['Material', 'SewerUsage'], as_index=False)\
            .agg({'Height': np.nanmean})\
            .rename(columns={'Height':'mat_usage_avg'})

    mat2 = frame\
            .groupby(['Material'], as_index=False)\
            .agg({'Height': np.nanmean})\
            .rename(columns={'Height':'mat_avg'})

    # First, impute by matching material and sewer usage
    frame = frame\
            .merge(mat, on=['Material', 'SewerUsage'])\
            .merge(mat2, on=['Material'])

    # Then matching by only material
    frame['Height'] = frame['Height']\
                        .fillna(frame['mat_usage_avg'])\
                        .fillna(frame['mat_avg'])

    # All pipes heights were imputed after this step, so no need for
    # futher imputation

    # Drop unused columns
    frame = frame.drop(['mat_usage_avg', 'mat_avg'], axis=1)

    return frame

def merge_nodes(frame, nodes):
    """
    Merge pipe data with nodes data
    """
    frame = frame\
            .merge(
                    nodes,
                    how='left',
                    left_on='UpNode',
                    right_on='NodeRefere')\
            .drop(
                    'NodeRefere',
                    axis=1)\
            .merge(
                    nodes,
                    how='left',
                    left_on='DownNode',
                    right_on='NodeRefere',
                    suffixes=('_up', '_down'))\
            .drop(
                    'NodeRefere',
                    axis=1)

    return frame

def interpolate(frame):
    """
    Interpolate points along the pipe
    """

    # Setup som vars
    selected_cols = [*frame.columns]
    remove_cols = ['fromX', 'fromY', 'toX', 'toY']

    for x in remove_cols:
        selected_cols.remove(x)

    frame_list = []

    for i, row in frame.iterrows():
        # Generate X 1 metre apart
        Xs = np.linspace(
                start=float(row['fromX']),
                stop=float(row['toX']),
                num=int(row['length_m'])
                )

        # Generate Y 1 metre apart
        Ys = np.linspace(
                start=float(row['fromY']),
                stop=float(row['toY']),
                num=int(row['length_m'])
                )

        # Convert to dataframe
        x = pd.DataFrame(np.array([Xs, Ys]).T)
        x.index = [i]*len(x)

        # Sore
        frame_list.append(x)

    # Combine all points coordinates
    # At this points, we end up with a dataframe of only Xs and Ys and row id
    points = pd.concat(frame_list)
    points.columns = ['X', 'Y']

    # Join on index - Hacky and lazy solution due to lack of sleep. But works.
    points[selected_cols] = frame[selected_cols].copy()

    # Clean up index
    points = points.reset_index(drop=True)

    return points

def compute_elevation_pipe(frame):
    """
    Compute elevation of up node and down node, taking into account pipe diam
    """
    frame['elevation_up'] = frame['CoverLevel_up'] - frame['UpDepth'] + frame['Height']
    frame['elevation_down'] = frame['CoverLevel_down'] - frame['DownDepth'] + frame['Height']

    return frame

def compute_elevation_point(points):
    """
    Compute elevation and depth of the interpolated points
    as the weighted average of the 2 ends
    """
    # distance from both ends
    points['from_X_up'] = np.abs(points['X'] - points['X_up'])
    points['from_X_down'] = np.abs(points['X_down'] - points['X'])

    # percentage of X distance along the line. Ex: 4 metre from X upstream, 6
    # metre from X downstream, means that 40% distance from X upstream
    points['pct_from_X_up'] = points['from_X_up'] / points[['from_X_up', 'from_X_down']].sum(axis=1)

    # elevation and cover level as weighted average
    points['elevation'] = points['elevation_up'] * (1-points['pct_from_X_up'])\
                        + points['elevation_down'] * (points['pct_from_X_up'])

    points['CoverLevel'] = points['CoverLevel_up'] * (1-points['pct_from_X_up'])\
                        + points['CoverLevel_down'] * (points['pct_from_X_up'])

    # Depth equals to cover level minus elevation
    points['depth'] = points['CoverLevel'] - points['elevation']

    # Drop unnecessary columns
    points = points.drop(['from_X_up', 'from_X_down', 'pct_from_X_up'], axis=1)

    return points

def get_nearest_in_area(X, Y, points, radius=10, n_points=10, latlon=True, json_output=True):
    # If input is in lat long (WGS84), convert to metre (BGS36)
    if latlon == True:
        result = convert_bng(X, Y)
        X, Y = [elem[0] for elem in result]

    # Limit search area. Not really 10 metre radius, but close. This makes the code
    # run faster as limit distance computations
    cond = (points['X'] < X + radius)\
             & (points['X'] > X - radius)\
             & (points['Y'] < Y + radius)\
             & (points['Y'] > Y - radius)

    # Compute distance from the requested points to all points in the search space
    in_radius = points[cond].copy()
    in_radius['distance'] = np.sqrt((in_radius['X'] - X)**2 + (in_radius['Y'] - Y)**2)

    # Get n closest points, order by distance, nearest first
    selected = in_radius.sort_values('distance').head(n_points)

    # select only relevant columns
    selected = selected[['ID', 'X', 'Y', 'distance', 'elevation', 'SewerUsage']]
#
    # Give json string to feed to other apps
    if json_output:
        selected = selected.to_json(orient='records')

    return selected
