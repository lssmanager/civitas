<?php
/**
 * Plugin Name: Civitas Roles Endpoint
 * Description: Exposes the WordPress role catalog for Civitas operational synchronization mappings.
 * Version: 1.0.0
 */

add_action('rest_api_init', function () {
    register_rest_route('civitas/v1', '/roles', array(
        'methods' => WP_REST_Server::READABLE,
        'callback' => function () {
            if (!function_exists('wp_roles')) {
                return new WP_Error('civitas_roles_unavailable', 'WordPress roles API is unavailable.', array('status' => 500));
            }

            $roles = array();
            foreach (wp_roles()->roles as $slug => $role) {
                $roles[] = array(
                    'slug' => $slug,
                    'name' => isset($role['name']) ? translate_user_role($role['name']) : $slug,
                    'description' => '',
                );
            }

            return rest_ensure_response(array('roles' => $roles));
        },
        'permission_callback' => function () {
            return current_user_can('list_users');
        },
    ));
});
